import { MIDIOutputPortMap } from "../types/midi";
import * as musicMetadata from 'music-metadata-browser';
import { readAsArrayBuffer } from "./common";

export const handleAudioFileOpen = async (file: File, midiOutputPortMap: MIDIOutputPortMap) => {
  const output = midiOutputPortMap.get(0);
  const audioBuffer = await readAsArrayBuffer(file);
  if(!(audioBuffer instanceof ArrayBuffer)) throw new Error("読み込めないファイルです。");

  const audioContext = new AudioContext();
  const audioAnalyzer = audioContext.createAnalyser();
  const audioSource = audioContext.createBufferSource();

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0.4;

  audioAnalyzer.fftSize = 2048;

  audioAnalyzer.connect(gainNode);
  gainNode.connect(audioContext.destination);
  audioContext.decodeAudioData(audioBuffer, buffer => {
    audioSource.buffer = buffer;
    audioSource.connect(audioAnalyzer);
    audioSource.start(0);

    // if(output) displayTrackInfomation(file, output);
    if(output) displayPlayerInfomation(output, 0);
    if(output) renderSpectrumAnalyzer(audioAnalyzer, output);
  });
};

const renderSpectrumAnalyzer = (audioAnalyzer: AnalyserNode, output: globalThis.WebMidi.MIDIOutput) => {
  const array = new Array(256);
  const spectrums = new Uint8Array(audioAnalyzer.frequencyBinCount);
  audioAnalyzer.getByteFrequencyData(spectrums);
  audioAnalyzer.smoothingTimeConstant = 0.1;

  for(let i=0; i<16; i++) {
    const barLength = spectrums[i * audioAnalyzer.frequencyBinCount / 16];
    for(let j=0; j<16; j++) {
      array[i*16 + j] = barLength / 16 >= (16 - j) ? 1 : 0;
    }
  }

  const data = [0x41, 0x10, 0x45, 0x12, 0x10, 0x01, 0x00];
  const dotData = new Array(64);

  for(let i=0; i<4; i++) {
    for(let j=0; j<16; j++) {
      if(i !== 3) dotData[i*16 + j] =
        (array[(i * 80) + j] << 4) |
        (array[(i * 80) + 16 + j] << 3) |
        (array[(i * 80) + 32 + j] << 2) |
        (array[(i * 80) + 48 + j] << 1) |
        (array[(i * 80) + 64 + j]);
      else {
        dotData[i*16 + j] = (array[(i * 80) + j]) << 4;
      }
    }
  }

  const checkSum = calculateCheckSum(data.concat(dotData).slice(4));

  output.send([0xF0].concat(data).concat(dotData).concat(checkSum).concat(0xF7));

  setTimeout(() => renderSpectrumAnalyzer(audioAnalyzer, output), 60);
};

const displayPlayerInfomation = (output: globalThis.WebMidi.MIDIOutput, playTime: number) => {
  const data = [0x41, 0x10, 0x45, 0x12, 0x10, 0x00, 0x00];

  const minutes = Math.floor(playTime / 60).toString().padStart(2, ' ');
  const seconds = Math.floor(playTime % 60).toString().padStart(2, '0');
  const sourceText = `${minutes}:${seconds}`.toString().padEnd(16, ' ');

  const textData: number[] = [];
  for (let i = 0; i < sourceText.length; i++) {
    const charCode = sourceText.charCodeAt(i);
    data.push(charCode < 128 ? charCode : 0x2a);
  }

  const checkSum = calculateCheckSum(data.concat(textData).slice(4));
  output.send([0xF0].concat(data).concat(textData).concat(checkSum).concat(0xF7));

  setTimeout(() => displayPlayerInfomation(output, playTime + 1), 1000);
};

const displayTrackInfomation = async (file: File, output: globalThis.WebMidi.MIDIOutput) => {
  const metadata = await musicMetadata.parseBlob(file);

  const data = [0x41, 0x10, 0x45, 0x12, 0x10, 0x00, 0x00];

  const title = metadata.common.title ? metadata.common.title : 'No Title';
  const artist = metadata.common.artist ? metadata.common.artist : 'No Artist';
  const sourceText = `${title} / ${artist}`.toString().slice(0, 32).padEnd(32, ' ');

  const textData: number[] = [];
  for (let i = 0; i < sourceText.length; i++) {
    const charCode = sourceText.charCodeAt(i);
    textData.push(charCode < 128 ? charCode : 0x2a);
  }

  const checkSum = calculateCheckSum(data.concat(textData).slice(4));
  output?.send([0xF0].concat(data).concat(textData).concat(checkSum).concat(0xF7));
};

const calculateCheckSum = (data: number[]): number => {
  const sum = data.reduce((a, x) => a + x);
  const checkSum = 128 - (sum % 128);
  return checkSum === 128 ? 0 : checkSum;
};
