import { readAsArrayBuffer } from "./common";

type MIDIEvent = ChannelMessage | SystemExclusiveMessage | MetaEvent | null;
type MetaEvent = EndOfTrack | SetTempo | PortSelect;

interface SequenceEvent {
  tick: number;
  midiEvent: TransmittableMessage | MetaEvent;
}

interface TransmittableMessage {
  outputPort: number;
  midiMessage: ChannelMessage | SystemExclusiveMessage;
}

interface ChannelMessage {
  content: Uint8Array | number[];
}

interface SystemExclusiveMessage {
  content: Uint8Array | number[];
}

interface EndOfTrack {
  metaEventType: MetaEventType.EndOfTrack;
}

interface SetTempo {
  metaEventType: MetaEventType.SetTempo;
  milliSecondsPerBeat: number;
}

interface PortSelect {
  metaEventType: MetaEventType.PortSelect;
  portNumber: number;
}

enum MIDIEventType {
  ChannelMessage = 0x00,
  SystemExclusiveMessageTypeA = 0xF0,
  SystemExclusiveMessageTypeB = 0xF7,
  MetaEvent = 0xFF,
}

enum MetaEventType {
  SequenceNumber = 0x00,
  Text = 0x01,
  CopyrightNotice = 0x02,
  SequenceOrTrackName = 0x03,
  InstrumentName = 0x04,
  Lylic = 0x05,
  Marker = 0x06,
  QueuePoint = 0x07,
  ProgramName = 0x08,
  DeviceName = 0x09,
  MIDIChannelPrefix = 0x20,
  EndOfTrack = 0x2F,
  SetTempo = 0x51,
  SMPTEOffset = 0x54,
  TimeSignature = 0x58,
  KeySignature = 0x59,
  PortSelect = 0x21,
}

export const handleFileOpen = async (file: File): Promise<[SequenceEvent[], number]> => {
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

  const trackEvents = tracks.map(track => parseTrack(track));

  // トラックごとのイベントを統合する
  const mergedEvents = mergeTrackEvents(...trackEvents);

  return new Promise((resolve, reject) => {
    return resolve([mergedEvents, timeBase]);
  });
};

const parseTrack = (trackBuffer: ArrayBuffer) => {
  const byteArray = new Uint8Array(trackBuffer);
  let totalDeltaTime: number = 0;

  const trackEventArray: SequenceEvent[] = [];
  let previousStatusByte = 0;
  let bufferPointer = 0;
  let portNumber = 0;

  while (bufferPointer < trackBuffer.byteLength) {
    const deltaTime = variableLengthQuantityToInt(byteArray.subarray(bufferPointer));
    const deltaTimeByteLength = variableLengthQuantityByteLength(byteArray.subarray(bufferPointer));

    totalDeltaTime += deltaTime;
    bufferPointer += deltaTimeByteLength;

    try {
      const [translatedEvent, eventLength] = translateEvent(byteArray, bufferPointer, previousStatusByte);

      if(translatedEvent && "content" in translatedEvent && translatedEvent.content[0] !== 0xF0 && translatedEvent.content[0] !== 0xF7) {
        previousStatusByte = translatedEvent.content[0];
      }

      // TransmittableMessage
      if(translatedEvent && "content" in translatedEvent) {
        trackEventArray.push({
          tick: totalDeltaTime,
          midiEvent: {
            outputPort: portNumber,
            midiMessage: translatedEvent
          }
        });
      }
      else if(translatedEvent !== null) {
        trackEventArray.push({
          tick: totalDeltaTime,
          midiEvent: translatedEvent
        });
      }

      if(translatedEvent && "portNumber" in translatedEvent) {
        portNumber = translatedEvent.portNumber;
      }

      bufferPointer += eventLength;
    } catch(e) {
      console.log(e);
      throw new Error("Track parse error. Track buffer pointer: " + bufferPointer);
    }
  }

  return trackEventArray;
};

const mergeTrackEvents = (...tracks: SequenceEvent[][]) => {
  const eventArray = [];
  const reversedTracks = tracks.map(track => track.reverse());
  while (reversedTracks.some(track => track.length > 0)) {
    const minimumTickTrack = reversedTracks
      .filter(track => track.length > 0)
      .reduce((a, b) => a[a.length - 1].tick < b[b.length - 1].tick ? a : b);
    const targetEvent = minimumTickTrack.pop();
    if (targetEvent) eventArray.push(targetEvent);
  }
  return eventArray;
};

const translateEvent = (byteArray: Uint8Array, bufferPointer: number, previousStatusByte: number): [MIDIEvent, number] => {
  if (byteArray[bufferPointer] === MIDIEventType.MetaEvent) {
    const metaEventLength = variableLengthQuantityToInt(byteArray.subarray(bufferPointer + 2));
    const metaEventLengthByteLength = variableLengthQuantityByteLength(byteArray.subarray(bufferPointer + 2));
    const bufferPointerAdvance = metaEventLengthByteLength + metaEventLength + 2;

    switch (byteArray[bufferPointer + 1]) {
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
      case 0x54: // SMPTE Offset
      case 0x58: // Time Signature
      case 0x59: // Key Signature
        return [null, bufferPointerAdvance];
      case 0x51: // Set Tempo
      const milliSecondsPerBeat = (
        (byteArray[bufferPointer + 3] << 16) |
        (byteArray[bufferPointer + 4] << 8) |
        byteArray[bufferPointer + 5]) / 1000;
        return [{
          metaEventType: MetaEventType.SetTempo,
          milliSecondsPerBeat: milliSecondsPerBeat
        }, bufferPointerAdvance];
      case 0x21: // Port Select
        return [{
          metaEventType: MetaEventType.PortSelect,
          portNumber: byteArray[bufferPointer + 3]
        }, bufferPointerAdvance];
      default:
        throw new Error("Unknown Meta Event");
    }
  }

  else if (byteArray[bufferPointer] === MIDIEventType.SystemExclusiveMessageTypeA) {
    const eventLength = variableLengthQuantityToInt(byteArray.subarray(bufferPointer + 1));
    const eventLengthByteLength = variableLengthQuantityByteLength(byteArray.subarray(bufferPointer + 1));
    const numberArray = Array.prototype.slice.call(
      byteArray.subarray(bufferPointer + eventLengthByteLength + 2, bufferPointer + eventLengthByteLength + eventLength)
    );
    return [{
      content: [0xF0, byteArray[bufferPointer + eventLengthByteLength + 1]].concat(numberArray, [0xF7])
    }, eventLengthByteLength + eventLength + 1];
  }

  else { // Channel Message
    const isRunningStatus = byteArray[bufferPointer] & 0x80;

    const statusByte = isRunningStatus ?
      byteArray[bufferPointer] :
      previousStatusByte;

    const dataBytesHeadPointer = isRunningStatus ?
      bufferPointer + 1 :
      bufferPointer;

    switch (statusByte & 0xF0) {
      case 0x80: // Note Off
      case 0x90: // Note On
      case 0xA0: // Polyphonic Key Pressure
      case 0xB0: // Control Change
      case 0xE0: // Pitch Bend
        if(byteArray[dataBytesHeadPointer] === undefined || byteArray[dataBytesHeadPointer + 1] === undefined)
          throw new Error("Buffer overrun!");
        return [{
          content: [statusByte, byteArray[dataBytesHeadPointer], byteArray[dataBytesHeadPointer + 1]]
        }, isRunningStatus ? 3 : 2];
      case 0xC0: // Program Change
      case 0xD0: // Channel Pressure
        if(byteArray[dataBytesHeadPointer] === undefined)
          throw new Error("Buffer overrun!" + bufferPointer);
        return [{
          content: [statusByte, byteArray[dataBytesHeadPointer]]
        }, isRunningStatus ? 2 : 1];
      default:
        throw new Error('Unknown Channel Message: ' + byteArray.slice(bufferPointer, bufferPointer + 3));
    }
  }
};

const variableLengthQuantityByteLength = (byteArray: Uint8Array): number => {
  if (byteArray[0] & 0x80) {
    if (byteArray[1] & 0x80) {
      if (byteArray[2] & 0x80) return 4;
      else return 3;
    }
    else return 2;
  }
  else return 1;
};

const variableLengthQuantityToInt = (byteArray: Uint8Array): number => {
  const byteLength = variableLengthQuantityByteLength(byteArray);
  if(byteLength === 1) {
    return byteArray[0];
  }
  else if(byteLength === 2) {
    return ((byteArray[0] & 0x7F) << 7 ) |
            (byteArray[1] & 0x7F);
  }
  else if(byteLength === 3) {
    return ((byteArray[0] & 0x7F) << 14) |
           ((byteArray[1] & 0x7F) << 7 ) |
            (byteArray[2] & 0x7F);
  }
  else if(byteLength === 4) {
    return ((byteArray[0] & 0x7F) << 21) |
           ((byteArray[1] & 0x7F) << 14) |
           ((byteArray[2] & 0x7F) << 7 ) |
            (byteArray[3] & 0x7F);
  }
  else throw new Error("可変長数値の計算に失敗しました。");
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
