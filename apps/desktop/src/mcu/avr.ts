// An AVR microcontroller (ATmega328P or ATmega2560) running a compiled sketch, on avr8js.
// It executes in slices of simulated time; every pin change is time-stamped (CPU cycles), so
// the host can see PWM duty cycles, servo pulses and tone frequencies, not just levels.
import {
  AVRADC, AVRClock, AVREEPROM, AVRIOPort, AVRSPI, AVRTimer, AVRTWI, AVRUSART, AVRWatchdog, CPU, EEPROMMemoryBackend,
  adcConfig, atmega328Channels, avrInstruction, clockConfig, eepromConfig, portAConfig, portBConfig, portCConfig,
  portDConfig, portEConfig, portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig,
  spiConfig, timer0Config, timer1Config, timer2Config, twiConfig, usart0Config, watchdogConfig, PinState,
  ADCMuxInputType,
  type ADCMuxConfiguration, type AVRPortConfig, type AVRTimerConfig,
} from "avr8js"
import type { BoardDef, PortName } from "./boards"
import { parseHex } from "./hex"
import { newTrack, takeWindow, trackChange, type I2CController, type I2CEvents, type Machine, type PinTrack } from "./machine"

const PORT_CONFIGS: Record<PortName, AVRPortConfig> = {
  A: portAConfig, B: portBConfig, C: portCConfig, D: portDConfig, E: portEConfig, F: portFConfig,
  G: portGConfig, H: portHConfig, J: portJConfig, K: portKConfig, L: portLConfig,
}

// ── ATmega2560: same register addresses for most peripherals, different interrupt vectors ──
// (vector word address = (vector number − 1) × 2, from the datasheet's vector table)
const v = (n: number) => (n - 1) * 2
const EXT = (index: number, eicr: number, iscOffset: number) => ({ EICR: eicr, EIMSK: 0x3d, EIFR: 0x3c, iscOffset, index, interrupt: v(2 + index) })
const megaPorts: Partial<Record<PortName, AVRPortConfig>> = {
  B: { ...portBConfig, pinChange: { PCIE: 0, PCICR: 0x68, PCIFR: 0x3b, PCMSK: 0x6b, pinChangeInterrupt: v(10), mask: 0xff, offset: 0 }, externalInterrupts: [] },
  D: { ...portDConfig, pinChange: undefined, externalInterrupts: [EXT(0, 0x69, 0), EXT(1, 0x69, 2), EXT(2, 0x69, 4), EXT(3, 0x69, 6)] },
  E: { ...portEConfig, externalInterrupts: [null, null, null, null, EXT(4, 0x6a, 0), EXT(5, 0x6a, 2), EXT(6, 0x6a, 4), EXT(7, 0x6a, 6)] },
  C: { ...portCConfig, pinChange: undefined, externalInterrupts: [] },
  J: { ...portJConfig, pinChange: undefined, externalInterrupts: [] },
  K: { ...portKConfig, pinChange: undefined, externalInterrupts: [] },
}
const PB = portBConfig.PORT, PE = portEConfig.PORT, PG = portGConfig.PORT, PH = portHConfig.PORT, PL = portLConfig.PORT
const t16 = (base: number, timsk: number, tifr: number, vec: number, port: number, pins: [number, number, number]): AVRTimerConfig => ({
  ...timer1Config, TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12,
  TIMSK: timsk, TIFR: tifr, captureInterrupt: v(vec), compAInterrupt: v(vec + 1), compBInterrupt: v(vec + 2), compCInterrupt: v(vec + 3), ovfInterrupt: v(vec + 4),
  compPortA: port, compPinA: pins[0], compPortB: port, compPinB: pins[1], compPortC: port, compPinC: pins[2], externalClockPort: 0, externalClockPin: 0,
})
const MEGA_TIMERS: AVRTimerConfig[] = [
  { ...timer0Config, compAInterrupt: v(22), compBInterrupt: v(23), ovfInterrupt: v(24), compPortA: PB, compPinA: 7, compPortB: PG, compPinB: 5 },
  { ...timer1Config, captureInterrupt: v(17), compAInterrupt: v(18), compBInterrupt: v(19), compCInterrupt: v(20), ovfInterrupt: v(21), compPortA: PB, compPinA: 5, compPortB: PB, compPinB: 6, compPortC: PB, compPinC: 7, OCRC: 0x8c },
  { ...timer2Config, compAInterrupt: v(14), compBInterrupt: v(15), ovfInterrupt: v(16), compPortA: PB, compPinA: 4, compPortB: PH, compPinB: 6 },
  t16(0x90, 0x71, 0x38, 32, PE, [3, 4, 5]),
  t16(0xa0, 0x72, 0x39, 42, PH, [3, 4, 5]),
  t16(0x120, 0x73, 0x3a, 47, PL, [3, 4, 5]),
]
const megaChannels: ADCMuxConfiguration = { ...atmega328Channels }
for (let i = 0; i < 8; i++) megaChannels[0x20 + i] = { type: ADCMuxInputType.SingleEnded, channel: 8 + i }

export type { PinTrack } from "./machine"

export interface AvrStats { cycles: number; seconds: number; speed: number }

export class AvrMachine implements Machine {
  readonly cpu: CPU
  readonly ports = new Map<PortName, AVRIOPort>()
  readonly usart: AVRUSART
  readonly adc: AVRADC
  readonly twi: AVRTWI
  readonly spi: AVRSPI
  readonly timers: AVRTimer[] = []
  readonly eeprom: AVREEPROM
  /** board pin name → its port bit (pins with a port bit only) */
  readonly track = new Map<string, PinTrack>()
  private byPortBit = new Map<string, string[]>()
  /** called after any pin's output level / direction changes (inside a slice) */
  onPinChange: ((pins: string[]) => void) | null = null
  onSerial: ((text: string) => void) | null = null
  private serialBuf = ""

  readonly board: BoardDef

  constructor(board: BoardDef, hex: string, eepromBytes?: Uint8Array) {
    this.board = board
    const prog = parseHex(hex, board.flash)
    this.cpu = new CPU(new Uint16Array(prog.buffer), board.sram)
    const mega = board.chip === "atmega2560"
    const usedPorts = new Set(Object.values(board.pins).filter((p) => p.bit >= 0 && p.port).map((p) => p.port!))
    for (const name of usedPorts) {
      const cfg = (mega && megaPorts[name]) || PORT_CONFIGS[name]
      const port = new AVRIOPort(this.cpu, cfg)
      this.ports.set(name, port)
      port.addListener(() => this.portChanged(name))
    }
    for (const [pin, bp] of Object.entries(board.pins)) {
      if (bp.bit < 0) continue
      const k = `${bp.port}${bp.bit}`
      this.byPortBit.set(k, [...(this.byPortBit.get(k) ?? []), pin])
      this.track.set(pin, newTrack())
    }
    for (const cfg of mega ? MEGA_TIMERS : [timer0Config, timer1Config, timer2Config]) this.timers.push(new AVRTimer(this.cpu, cfg))
    this.usart = new AVRUSART(this.cpu, mega ? { ...usart0Config, rxCompleteInterrupt: v(26), dataRegisterEmptyInterrupt: v(27), txCompleteInterrupt: v(28) } : usart0Config, board.hz)
    this.usart.onByteTransmit = (b) => { this.serialBuf += String.fromCharCode(b) }
    this.adc = new AVRADC(this.cpu, mega ? { ...adcConfig, adcInterrupt: v(30), numChannels: 16, muxChannels: megaChannels } : adcConfig)
    this.twi = new AVRTWI(this.cpu, mega ? { ...twiConfig, twiInterrupt: v(40) } : twiConfig, board.hz)
    this.spi = new AVRSPI(this.cpu, mega ? { ...spiConfig, spiInterrupt: v(25) } : spiConfig, board.hz)
    const backend = new EEPROMMemoryBackend(mega ? 4096 : 1024)
    this.eepromBackend = backend
    if (eepromBytes) backend.memory.set(eepromBytes.subarray(0, backend.memory.length))
    this.eeprom = new AVREEPROM(this.cpu, backend, mega ? { ...eepromConfig, eepromReadyInterrupt: v(31) } : eepromConfig)
    const clock = new AVRClock(this.cpu, board.hz, clockConfig)
    new AVRWatchdog(this.cpu, mega ? { ...watchdogConfig, watchdogInterrupt: v(13) } : watchdogConfig, clock)
  }

  get eepromMemory(): Uint8Array { return this.eepromBackend.memory }
  private eepromBackend: EEPROMMemoryBackend

  private portChanged(name: PortName) {
    const port = this.ports.get(name)!
    const now = this.cpu.cycles
    const changed: string[] = []
    for (let bit = 0; bit < 8; bit++) {
      const pins = this.byPortBit.get(`${name}${bit}`)
      if (!pins) continue
      const st = port.pinState(bit)
      const out = st === PinState.High ? true : st === PinState.Low ? false : null
      const pullup = st === PinState.InputPullUp
      for (const pin of pins) {
        if (trackChange(this.track.get(pin)!, out, pullup, false, now)) changed.push(pin)
      }
    }
    if (changed.length) this.onPinChange?.(changed)
  }

  /** Drive an input pin from outside (a button, another chip, a net's voltage). */
  setInput(pin: string, high: boolean) {
    const bp = this.board.pins[pin]
    if (!bp || bp.bit < 0) return
    if (bp.port) this.ports.get(bp.port)?.setPin(bp.bit, high)
  }

  /** The voltage the ADC sees on an analog channel. */
  setAnalog(channel: number, volts: number) { this.adc.channelValues[channel] = volts }

  /** Send text to the sketch's Serial (as if typed in the Serial Monitor). */
  serialWrite(text: string) { this.rx.push(...Array.from(text, (c) => c.charCodeAt(0) & 0xff)) }
  private rx: number[] = []

  /** Run for `cycles` CPU cycles, in sub-slices of `step` cycles with a callback between them. */
  run(cycles: number, step = 1000, between?: () => void) {
    const cpu = this.cpu
    const end = cpu.cycles + cycles
    while (cpu.cycles < end) {
      const stop = Math.min(end, cpu.cycles + step)
      while (cpu.cycles < stop) {
        avrInstruction(cpu)
        cpu.tick()
      }
      if (this.rx.length && this.usart.writeByte(this.rx[0])) this.rx.shift()
      between?.()
    }
    if (this.serialBuf) { const s = this.serialBuf; this.serialBuf = ""; this.onSerial?.(s) }
  }

  takeWindow() { return takeWindow(this.track, this.cpu.cycles) }

  get hz() { return this.board.hz }
  get now() { return this.cpu.cycles }
  runFor(ticks: number) { this.run(ticks, 1000) }
  schedule(fn: () => void, ticks: number) { this.cpu.addClockEvent(fn, Math.max(1, Math.round(ticks))) }
  attachI2C(events: I2CEvents): I2CController {
    this.twi.eventHandler = {
      start: (r) => events.start(r), stop: () => events.stop(), connectToSlave: (a, w) => events.connectToSlave(a, w),
      writeByte: (v) => events.writeByte(v), readByte: (ack) => events.readByte(ack),
    }
    return this.twi
  }

  /** Simulated seconds so far. */
  get seconds() { return this.cpu.cycles / this.board.hz }
}
