import React from 'react';
// import './TrackMonitor.css';

function TrackMonitor() {
  const keyboardView = [].map((value, index) => {
    return <p>{ index }</p>
  });
  return (
    <div className="TrackMonitor">
      <h2>Track Monitor</h2>
      { keyboardView }
    </div>
  );
}

export default TrackMonitor;
