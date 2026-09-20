export class ForestAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private nextBird = 0;
  private engine: OscillatorNode | undefined;
  private engineVolume: GainNode | undefined;
  private siren: OscillatorNode | undefined;
  private sirenVolume: GainNode | undefined;
  private cityVolume: GainNode | undefined;
  private cityFilter: BiquadFilterNode | undefined;
  enabled = false;

  async toggle(): Promise<boolean> {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 4, this.context.sampleRate);
      const samples = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < samples.length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025;
        samples[i] = last * 3;
      }
      const wind = this.context.createBufferSource();
      wind.buffer = buffer;
      wind.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 450;
      wind.connect(filter).connect(this.master);
      this.cityFilter = this.context.createBiquadFilter();
      this.cityFilter.type = "bandpass";
      this.cityFilter.frequency.value = 750;
      this.cityFilter.Q.value = 0.7;
      this.cityVolume = this.context.createGain();
      this.cityVolume.gain.value = 0;
      wind.connect(this.cityFilter).connect(this.cityVolume).connect(this.master);
      wind.start();
      this.engine = this.context.createOscillator();
      this.engine.type = "triangle";
      this.engineVolume = this.context.createGain();
      this.engineVolume.gain.value = 0;
      this.engine.connect(this.engineVolume).connect(this.master);
      this.engine.start();
      this.siren = this.context.createOscillator();
      this.siren.type = "sine";
      this.sirenVolume = this.context.createGain();
      this.sirenVolume.gain.value = 0;
      this.siren.connect(this.sirenVolume).connect(this.master);
      this.siren.start();
    }
    await this.context.resume();
    this.enabled = !this.enabled;
    this.master!.gain.setTargetAtTime(this.enabled ? 0.14 : 0, this.context.currentTime, 0.6);
    return this.enabled;
  }

  update(elapsed: number, night = false, city = false, speed?: number, playing = true, flying = false, pursuit = false): void {
    if (!this.context || !this.master) return;
    this.engine?.frequency.setTargetAtTime(45 + Math.abs(speed ?? 0) * 5, this.context.currentTime, 0.12);
    this.engineVolume?.gain.setTargetAtTime((city || flying) && speed !== undefined && playing ? 0.24 : 0, this.context.currentTime, 0.15);
    this.siren?.frequency.setTargetAtTime(650 + Math.sin(elapsed * 5) * 200, this.context.currentTime, 0.08);
    this.sirenVolume?.gain.setTargetAtTime(pursuit && playing ? 0.13 : 0, this.context.currentTime, 0.2);
    this.cityVolume?.gain.setTargetAtTime(city && playing ? 0.3 + Math.sin(elapsed * 0.37) * 0.1 : 0, this.context.currentTime, 0.5);
    this.cityFilter?.frequency.setTargetAtTime(650 + Math.sin(elapsed * 0.2) * 220, this.context.currentTime, 0.6);
    if (!this.enabled || !playing || elapsed < this.nextBird || night || city || flying) return;
    this.nextBird = elapsed + 3 + Math.random() * 7;
    const start = this.context.currentTime;
    for (let i = 0; i < 3; i++) {
      const bird = this.context.createOscillator();
      const volume = this.context.createGain();
      const t = start + i * 0.18;
      bird.type = "sine";
      bird.frequency.setValueAtTime(2100 + Math.random() * 700, t);
      bird.frequency.exponentialRampToValueAtTime(3300, t + 0.07);
      bird.frequency.exponentialRampToValueAtTime(2300, t + 0.14);
      volume.gain.setValueAtTime(0, t);
      volume.gain.linearRampToValueAtTime(0.13, t + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      bird.connect(volume).connect(this.master);
      bird.start(t);
      bird.stop(t + 0.17);
      bird.onended = () => { bird.disconnect(); volume.disconnect(); };
    }
  }
}
