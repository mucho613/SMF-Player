import React from 'react';

interface Props {
  onFileOpen: (file: File) => void;
}

class FileOpenButton extends React.Component<Props, {}> {
  file: any;
  handleFileOpen: (file: File) => void;

  constructor(props: Props) {
    super(props);
    this.file = React.createRef();
    this.handleFileOpen = props.onFileOpen;
  }

  componentDidMount() {
    this.file.current.addEventListener('change', (e: any) => {
      var target = e.target;
      var files = target.files;
      this.handleFileOpen(files[0]);
    }, false);
  }

  render() {
    return <input type="file" ref={this.file}></input>
  }
}

export default FileOpenButton;
