"""Production contracts for the event-driven overhaul audio director."""

from contextlib import contextmanager
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

import pytest


ROOT = Path(__file__).resolve().parents[2]

FAKE_WEB_AUDIO = r"""
(() => {
  class FakeParam {
    constructor(value = 0) { this.value = value; this.automation = []; }
    cancelScheduledValues(time) { this.automation.push(['cancel', time]); }
    setValueAtTime(value, time) { this.value = value; this.automation.push(['set', value, time]); }
    setTargetAtTime(value, time, constant) {
      this.value = value; this.automation.push(['target', value, time, constant]);
    }
    linearRampToValueAtTime(value, time) {
      this.value = value; this.automation.push(['linear', value, time]);
    }
    exponentialRampToValueAtTime(value, time) {
      this.value = value; this.automation.push(['exponential', value, time]);
    }
  }
  class FakeNode {
    constructor() {
      this.gain = new FakeParam(1);
      this.frequency = new FakeParam(440);
      this.connections = [];
      this.started = 0;
      this.stopped = 0;
    }
    connect(node) { this.connections.push(node); return node; }
    disconnect() { this.connections = []; }
    start() { this.started += 1; }
    stop() { this.stopped += 1; }
  }
  class FakeContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 10;
      this.sampleRate = 8000;
      this.destination = new FakeNode();
    }
    createGain() { return new FakeNode(); }
    createOscillator() { return new FakeNode(); }
    createBiquadFilter() { return new FakeNode(); }
    createBufferSource() { return new FakeNode(); }
    createBuffer(channels, length) {
      const values = Array.from({length: channels}, () => new Float32Array(length));
      return { getChannelData: channel => values[channel] };
    }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
  }
  window.__FakeOverhaulAudioContext = FakeContext;
  window.__overhaulAudioContextFactory = () => new FakeContext();
})();
"""


@contextmanager
def _live_server():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "serve.py"), str(port)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 8
        while True:
            try:
                with urlopen(f"{url}/overhaul.html", timeout=0.5) as response:
                    if response.status == 200:
                        break
            except OSError:
                if time.monotonic() >= deadline:
                    raise AssertionError("overhaul audio test server did not start")
                time.sleep(0.05)
        yield url
    finally:
        process.terminate()
        process.wait(timeout=5)


@pytest.fixture
def audio_page(page, errors):
    page.add_init_script(FAKE_WEB_AUDIO)
    with _live_server() as base_url:
        page.goto(f"{base_url}/overhaul.html?seed=audio-production-contract")
        page.wait_for_function("() => window.__overhaulAcceptance?.ready === true")
        yield page
    assert not errors, f"audio integration emitted browser errors: {errors!r}"


def test_main_commits_audio_on_the_same_tick_and_exposes_independent_mix(audio_page):
    before = audio_page.evaluate("window.__overhaulAcceptance.audioSnapshot()")
    assert before["contextState"] == "uninitialized"
    assert before["score"]["loopsCreated"] == 0

    unlocked = audio_page.evaluate(
        "window.__overhaulAcceptance.audioControl({unlock: true})"
    )
    assert unlocked["contextState"] == "running"
    assert unlocked["score"]["loopsCreated"] == 12
    assert unlocked["score"]["activeLoops"] == 12

    mixed = audio_page.evaluate(
        """window.__overhaulAcceptance.audioControl({
          musicVolume: 0.21, sfxVolume: 0.83, musicMuted: true, sfxMuted: false
        })"""
    )
    assert mixed["mix"]["music"] == {"volume": 0.21, "muted": True, "effective": 0}
    assert mixed["mix"]["sfx"] == {"volume": 0.83, "muted": False, "effective": 0.83}

    audio_page.evaluate(
        """() => {
          const target=window.__overhaulAcceptance.snapshot().recovery.targets[0];
          return window.__overhaulAcceptance.command({
            type:'repair-structure', entityId:target.entityId
          });
        }"""
    )
    committed = audio_page.evaluate(
        """() => ({
          audio: window.__overhaulAcceptance.audioSnapshot(),
          tick: window.__overhaulAcceptance.snapshot().ticks.completed,
          uiTick: Number(document.documentElement.dataset.uiTick),
        })"""
    )
    assert committed["audio"]["lastCommittedTick"] == committed["tick"] == committed["uiTick"]
    assert committed["audio"]["score"]["state"] == "building"
    assert committed["audio"]["score"]["transitionMs"] == 1200
    assert committed["audio"]["score"]["layerTargets"]["building"] == 1

    # Repeated unlocks resume the one graph; they never leak another score loop.
    again = audio_page.evaluate(
        "window.__overhaulAcceptance.audioControl({unlock: true})"
    )
    assert again["score"]["loopsCreated"] == 12


def test_semantic_score_sfx_cooldowns_lifecycle_and_destroy_contract(audio_page):
    result = audio_page.evaluate(
        """async () => {
          const {createOverhaulAudio} = await import('/src/overhaul/audio.js?focused-test=1');
          let now = 1000;
          let nextTimer = 1;
          const timers = new Map();
          const clock = {
            now: () => now,
            setTimeout: (callback, delay) => {
              const id = nextTimer++;
              timers.set(id, {callback, at: now + delay});
              return id;
            },
            clearTimeout: id => timers.delete(id),
          };
          const audio = createOverhaulAudio({
            contextFactory: () => new window.__FakeOverhaulAudioContext(),
            clock,
            storage: null,
          });
          await audio.unlock();
          const snapshot = (tick, patch = {}) => ({
            seed: 'semantic-audio',
            ticks: {raw: tick, completed: tick},
            structures: [{id: 'computer-1', kind: 'computer'}],
            computers: [{id: 'computer-1', state: 'loaded', fault: null}],
            actors: [],
            ai: {activeFaults: []},
            sell: {blocked: false},
            ...patch,
          });
          const states = {};
          audio.commit(snapshot(1), [{id: 'build-1', tick: 1, type: 'structure.placed'}]);
          states.building = audio.inspect().score.state;
          audio.commit(snapshot(2, {
            ai: {activeFaults: [{entityId: 'computer-1'}]},
          }), [{id: 'fault-1', tick: 2, type: 'ai.fault-raised', entityId: 'computer-1'}]);
          states.pressure = audio.inspect().score.state;
          const firstFault = audio.inspect();

          // A second incident for the same machine is deduplicated by recipe cooldown.
          audio.commit(snapshot(3, {
            ai: {activeFaults: [{entityId: 'computer-1'}]},
          }), [{id: 'fault-2', tick: 3, type: 'ai.fault-raised', entityId: 'computer-1'}]);
          const cooledDown = audio.inspect();

          now += 1800;
          audio.commit(snapshot(4, {
            ai: {activeFaults: [{entityId: 'computer-1'}]},
          }), [
            {id: 'fault-3', tick: 4, type: 'ai.fault-raised', entityId: 'computer-1'},
            {id: 'repair-1', tick: 4, type: 'ai.repair-started', entityId: 'computer-1'},
            {id: 'repair-2', tick: 4, type: 'ai.repair-progressed', entityId: 'computer-1'},
          ]);
          const repaired = audio.inspect();
          audio.commit(snapshot(5), [
            {id: 'level-1', tick: 5, type: 'ai.level-up', entityId: 'aurora'},
          ]);
          states.breakthrough = audio.inspect().score.state;

          now += 1800;
          audio.commit(snapshot(6, {
            structures: [{id: 'cooling-1', kind: 'cooling-source'}],
            ai: {activeFaults: [{entityId: 'cooling-1'}]},
          }), [{id: 'cooling-fault', tick: 6, type: 'ai.fault-raised', entityId: 'cooling-1'}]);
          audio.commit(snapshot(7, {
            structures: [{id: 'power-1', kind: 'power-source'}],
            ai: {activeFaults: [{entityId: 'power-1'}]},
          }), [{id: 'power-fault', tick: 7, type: 'ai.fault-raised', entityId: 'power-1'}]);
          const flood = Array.from({length: 20}, (_, index) => ({
            id: `incident-${index}`,
            tick: 8,
            type: 'ai.fault-raised',
            entityId: `machine-${index}`,
          }));
          audio.commit(snapshot(8, {
            structures: flood.map((event) => ({id: event.entityId, kind: 'computer'})),
            ai: {activeFaults: flood.map((event) => ({entityId: event.entityId}))},
          }), flood);
          const mechanical = audio.inspect();

          audio.setVisibility(true);
          await Promise.resolve();
          const hiddenState = audio.inspect().contextState;
          audio.setVisibility(false);
          await Promise.resolve();
          const visibleState = audio.inspect().contextState;
          audio.setPageSuspended(true);
          await Promise.resolve();
          const pageHiddenState = audio.inspect().contextState;
          audio.setPageSuspended(false);
          await Promise.resolve();

          await audio.destroy();
          return {
            states,
            firstFault,
            cooledDown,
            repaired,
            mechanical,
            hiddenState,
            visibleState,
            pageHiddenState,
            destroyed: audio.inspect(),
            remainingTimers: timers.size,
          };
        }"""
    )

    assert result["states"] == {
        "building": "building",
        "pressure": "pressure",
        "breakthrough": "breakthrough",
    }
    assert result["firstFault"]["sfx"]["playedByRecipe"]["relay-snap"] == 1
    assert result["firstFault"]["sfx"]["playedByRecipe"]["fan-grind-down"] == 1
    assert result["cooledDown"]["sfx"]["cooldownSuppressed"] == 2
    assert result["repaired"]["sfx"]["playedByRecipe"]["relay-snap"] == 2
    assert result["repaired"]["sfx"]["playedByRecipe"]["fan-grind-down"] == 2
    assert result["repaired"]["sfx"]["playedByRecipe"]["repair-servo"] == 1
    assert result["repaired"]["sfx"]["playedByRecipe"]["repair-tool"] == 1
    assert result["mechanical"]["sfx"]["playedByRecipe"]["coolant-hiss"] == 1
    assert result["mechanical"]["sfx"]["playedByRecipe"]["transformer-thump"] == 1
    assert result["mechanical"]["sfx"]["activeVoices"] <= 10
    assert result["mechanical"]["sfx"]["peakPolyphony"] <= 10
    assert result["mechanical"]["sfx"]["polyphonyDropped"] > 0
    assert result["hiddenState"] == "suspended"
    assert result["visibleState"] == "running"
    assert result["pageHiddenState"] == "suspended"
    assert result["destroyed"]["lifecycle"]["destroyed"] is True
    assert result["destroyed"]["contextState"] == "closed"
    assert result["destroyed"]["score"]["activeLoops"] == 0
    assert result["destroyed"]["sfx"]["activeVoices"] == 0
    assert result["destroyed"]["sfx"]["pendingCleanupTimers"] == 0
    assert result["remainingTimers"] == 0
