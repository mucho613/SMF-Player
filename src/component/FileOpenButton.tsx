import React from 'react';

interface Props {
  onFileOpen: (file: File) => void;
}

function FileOpenButton(props: Props) {
  return (
    <input onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if(files?.length === 1) props.onFileOpen(files[0]);
    }} type="file"></input>
  )
}

export default FileOpenButton;
