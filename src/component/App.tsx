import * as WebMidi from "webmidi";
import React, { useEffect, useState } from 'react';
import MIDISettingPanel from '../component/MIDISettingPanel';
import { handleFileOpen } from '../player/midi';
import { handleAudioFileOpen } from '../player/audio';
import './App.css';

import FileOpenButton from './FileOpenButton';
import { MIDIOutputPortMap } from '../types/midi';
import TrackMonitor from './TrackMonitor';

function App() {
  const [midiOutputs, setMIDIOutputs] = useState<globalThis.WebMidi.MIDIOutputMap>(new Map());
  const [midiOutputPortMap, setMIDIOutputPortMap] = useState<MIDIOutputPortMap>(new Map());

  useEffect(() => {
    navigator.requestMIDIAccess({ sysex: true }).then(midiAccess => setMIDIOutputs(midiAccess.outputs));
  }, []);

  return (
    <div className="App">
      <FileOpenButton onFileOpen={async (file) => {
        if(file.type === "audio/mid") {
          const [eventArray, timebase] = await handleFileOpen(file);

          const startTime = WebMidi.default.time;
          let lastTempoChangedTime = 0;
          let lastTempoChangedTick = 0;
          let milliSecondsPerBeat = 500;

          for(let event of eventArray) {
            const targetTime =
              startTime +
              lastTempoChangedTime +
              (event.tick - lastTempoChangedTick) / timebase * milliSecondsPerBeat; // 現在利用中のテンポが適用されてから現在までの経過時間(ms)
            if("byteArray" in event.content) {
              midiOutputPortMap.get(event.outputPort)?.send(event.content.byteArray, targetTime);
            }
            if("milliSecondsPerBeat" in event.content) {
              lastTempoChangedTime = lastTempoChangedTime + (event.tick - lastTempoChangedTick) / timebase * milliSecondsPerBeat;
              lastTempoChangedTick = event.tick;
              milliSecondsPerBeat = event.content.milliSecondsPerBeat;
            }
          }

        }
        else handleAudioFileOpen(file, midiOutputPortMap);
      }} />
      <MIDISettingPanel
        midiOutputs={midiOutputs}
        onSelectMIDIOutput={(outputPortNumber: number, midiOutput: globalThis.WebMidi.MIDIOutput) => {
          midiOutput.open();
          setMIDIOutputPortMap(midiOutputPortMap.set(outputPortNumber, midiOutput));
        }}
      />
      <TrackMonitor />
    </div>
  );
}

export default App;
