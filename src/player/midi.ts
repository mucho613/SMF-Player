import { readAsArrayBuffer } from "./common";

interface MIDIEvent {
  tick: number;
  outputPort: number;
  type: MIDIEventType;
  content: MIDIMessage | TempoChange;
}

interface MIDIMessage {
  byteArray: Uint8Array | number[];
}

interface TempoChange {
  milliSecondsPerBeat: number;
}

enum MIDIEventType {
  MIDIMessage = 0,
  TempoChange = 1
}

export const handleFileOpen = async (file: File): Promise<[MIDIEvent[], number]> => {
  const buffer = await readAsArrayBuffer(file);

  if(!(buffer instanceof ArrayBuffer)) throw new Error("読み込めないファイルです。");
  const dataView = new DataView(buffer);
  smfValidate(dataView);

  const numberOfTracks = dataView.getUint16(10);
  const timeBase = dataView.getUint16(12);

  let tracks: ArrayBuffer[] = [];
  let trackTopPosition: number = 14;

  for (let i = 0; i < numberOfTracks; i++) {
    smfTrackValidate(dataView, trackTopPosition);
    const trackLength = dataView.getUint32(trackTopPosition + 4);
    tracks.push(buffer.slice(trackTopPosition + 8, trackTopPosition + 8 + trackLength)); // 8 は 'MTrk' と Track Length の 8 バイト
    trackTopPosition = trackTopPosition + 8 + trackLength;
  }

  const trackEventArray = tracks.map(track => trackParse(track));

  // トラックごとのイベントを統合する
  const eventArray = mergeTrack(trackEventArray);

  return new Promise((resolve, reject) => {
    return resolve([eventArray, timeBase]);
  });
};

const smfValidate = (dataView: DataView) => {
  const mthdSignature = dataView.getUint32(0);
  if (mthdSignature !== 0x4D546864)
    throw new Error("MThd シグネチャが不正なため、読み込むことができません。");

  const headerChankLength = dataView.getUint32(4);
  if (headerChankLength !== 6)
    throw new Error("MThd チャンクの長さが 6 でないため、読み込むことができません。");

  const format = dataView.getUint16(8);
  if (format !== 0 && format !== 1)
    throw new Error("SMF Format が 0, 1 のいずれかでないため、読み込むことができません。");
};

const smfTrackValidate = (dataView: DataView, trackTopPosition: number) => {
  const mtrkSignature = dataView.getUint32(trackTopPosition);
  if (mtrkSignature !== 0x4D54726B)
    throw new Error("MTrk シグネチャが不正なため、読み込むことができません。");
};

const variableLengthQuantityToInt = (byteArray: Uint8Array, start: number): { quantity: number, byteLength: number } => {
  let quantity = 0, byteLength: number = 0;

  for(let i=0; i<4; i++) {
    // Delta time(可変長数値表現)
    if(!(byteArray[start + i] & 0b10000000)) {
      for(let j=0; j<i + 1; j++) {
        quantity |= ((0b01111111 & byteArray[start + i - j]) << (7 * j));
      }
      byteLength = i + 1;
      break;
    }
  }

  return {
    quantity: quantity,
    byteLength: byteLength
  };
};

const trackParse = (track: ArrayBuffer) => {
  const byteArray = new Uint8Array(track);
  let totalDeltaTime: number = 0;

  const trackEventArray: MIDIEvent[] = [];
  let previousStatusByte = 0;

  let outputPort = 0;

  for (let i = 0; i < track.byteLength; i++) {
    const deltaTime = variableLengthQuantityToInt(byteArray, i);

    i += deltaTime.byteLength;
    totalDeltaTime += deltaTime.quantity;

    if (byteArray[i] === 0xFF) {
      // メタイベント種類の判別
      switch (byteArray[i + 1]) {
        case 0x00: // Sequence Number
        case 0x01: // Text
        case 0x02: // Copyright Notice
        case 0x03: // Sequence / Track Name
        case 0x04: // Instrument Name
        case 0x05: // Lylic
        case 0x06: // Marker
        case 0x07: // Queue Point
        case 0x08: // Program Name
        case 0x09: // Device Name
        case 0x20: // MIDI Channel Prefix
        case 0x2F: // End of Track
          break;
        case 0x51: // Set Tempo
          const milliSecondsPerBeat = ((byteArray[i + 3] << 16) | (byteArray[i + 4] << 8) | byteArray[i + 5]) / 1000;
          trackEventArray.push({
            tick: totalDeltaTime,
            outputPort: 0,
            type: MIDIEventType.TempoChange,
            content: { milliSecondsPerBeat }
          });
          break;
        case 0x54: // SMPTE Offset
        case 0x58: // Time Signature
        case 0x59: // Key Signature
          break;
        case 0x21: // Port Select
          outputPort = byteArray[i + 3];
          break;
        default:
          throw new Error("Unknown Meta Event");
      }

      const metaEventLength = variableLengthQuantityToInt(byteArray, i + 2);
      i += metaEventLength.byteLength + metaEventLength.quantity + 1;
    }

    else if (byteArray[i] === 0xF0) {
      const eventLength = variableLengthQuantityToInt(byteArray, i + 1);
      const numberArray = Array.prototype.slice.call(
        byteArray.subarray(i + eventLength.byteLength + 2, i + eventLength.byteLength + eventLength.quantity)
      );
      trackEventArray.push({
        tick: totalDeltaTime,
        outputPort: outputPort,
        type: MIDIEventType.MIDIMessage,
        content: { byteArray: [0xF0, byteArray[i + eventLength.byteLength + 1]].concat(numberArray, [0xF7]) }
      });

      i += eventLength.byteLength + eventLength.quantity;
    }
    // TODO: 0xF7 ステータスのやつを書く
    else {
      if (byteArray[i] & 0b10000000)
        previousStatusByte = byteArray[i]; // Channel Message
      else
        i--;

      let dataByteLength = 0;

      // チャンネル情報を AND で捨てて判定する
      switch (previousStatusByte & 0xF0) {
        case 0x80: // Note Off
        case 0x90: // Note On
        case 0xA0: // Polyphonic Key Pressure
        case 0xB0: // Control Change
        case 0xE0: // Pitch Bend
          dataByteLength = 2;
          break;
        case 0xC0: // Program Change
        case 0xD0: // Channel Pressure
          dataByteLength = 1;
          break;
        default:
          throw new Error('Unknown Channel Message');
      }
      if (dataByteLength === 1) {
        trackEventArray.push({
          tick: totalDeltaTime,
          outputPort: outputPort,
          type: MIDIEventType.MIDIMessage,
          content: { byteArray: [previousStatusByte, byteArray[i + 1]] }
        });
      }
      else if (dataByteLength === 2) {
        trackEventArray.push({
          tick: totalDeltaTime,
          outputPort: outputPort,
          type: MIDIEventType.MIDIMessage,
          content: { byteArray: [previousStatusByte, byteArray[i + 1], byteArray[i + 2]] }
        });
      }

      i += dataByteLength;
    }
  }

  return trackEventArray;
};

function mergeTrack(trackEventArray: MIDIEvent[][]) {
  const eventArray = [];
  while (trackEventArray.some(track => track.length > 0)) {
    let minimumTick = Number.MAX_SAFE_INTEGER;
    let targetTrack: MIDIEvent[] | null = [];
    for (let track of trackEventArray) {
      if (minimumTick > track[0]?.tick) {
        minimumTick = track[0].tick;
        targetTrack = track;
      }
    }
    const targetEvent = targetTrack.shift();
    if (targetEvent) eventArray.push(targetEvent);
  }
  return eventArray;
}

