export const calculateCheckSum = (data: number[]): number => {
  const sum = data.reduce((a, x) => a + x);
  const checkSum = 128 - (sum % 128);
  return checkSum === 128 ? 0 : checkSum;
}

export const readAsArrayBuffer = (file: File): Promise<string | ArrayBuffer | null> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  })
}
