import React from 'react';
import './MIDISettingPanel.css';

interface Props {
  midiOutputs: WebMidi.MIDIOutputMap;
  onSelectMIDIOutput: (outputPortNumber: number, midiOutput: WebMidi.MIDIOutput) => void;
}

function MIDISettingPanel(props: Props) {
  const midiOutputSelectors = ["A", "B", "C", "D"].map((outputPortSignature, index) => {
    return (
      <div key={outputPortSignature}>
        <p>MIDI Output Device { outputPortSignature }</p>
        <select onChange={event => {
          const midiOutput = props.midiOutputs.get(event.target.value);
          if(midiOutput) props.onSelectMIDIOutput(index, midiOutput);
        }}>
          {
            Array.from(props.midiOutputs.values()).map(midiOutput =>
              <option value={midiOutput.id} key={midiOutput.id}>{ midiOutput.name }</option>
            ).concat(
              <option value="unset" key="unset">未設定</option>
            )
          }
        </select>
      </div>
    )
  });

  return <div className="MIDISettingPanel">{ midiOutputSelectors }</div>;
}

export default MIDISettingPanel;
