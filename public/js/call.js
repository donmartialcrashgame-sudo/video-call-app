const socket = io();

const myIdInput = document.querySelector('#myId');
const peerIdInput = document.querySelector('#peerId');
const registerBtn = document.querySelector('#registerBtn');
const videoCallBtn = document.querySelector('#videoCallBtn');
const audioCallBtn = document.querySelector('#audioCallBtn');
const statusEl = document.querySelector('#status');
const callCard = document.querySelector('#callCard');
const incomingCall = document.querySelector('#incomingCall');
const incomingText = document.querySelector('#incomingText');
const acceptBtn = document.querySelector('#acceptBtn');
const rejectBtn = document.querySelector('#rejectBtn');
const localVideo = document.querySelector('#localVideo');
const remoteVideo = document.querySelector('#remoteVideo');
const muteBtn = document.querySelector('#muteBtn');
const cameraBtn = document.querySelector('#cameraBtn');
const endBtn = document.querySelector('#endBtn');

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

let myId = '';
let peerId = '';
let peerConnection = null;
let localStream = null;
let pendingCaller = null;
let callType = 'video';

function setStatus(message) {
  statusEl.textContent = message;
}

async function requestMedia(type) {
  return navigator.mediaDevices.getUserMedia({
    video: type === 'video',
    audio: true
  });
}

function createPeerConnection(targetUserId) {
  peerConnection?.close();
  peerConnection = new RTCPeerConnection(rtcConfig);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', {
        to: targetUserId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    setStatus(`Call connection: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'failed') cleanupCall(false);
  };

  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }

  return peerConnection;
}

async function startCall(type) {
  peerId = peerIdInput.value.trim();
  if (!myId || !peerId) return setStatus('Enter both user IDs first.');
  if (myId === peerId) return setStatus('You cannot call yourself.');

  callType = type;
  try {
    localStream = await requestMedia(type);
    localVideo.srcObject = localStream;
    callCard.hidden = false;
    createPeerConnection(peerId);
    socket.emit('call-user', { to: peerId, callType: type });
    setStatus(`Calling ${peerId}...`);
  } catch (error) {
    console.error(error);
    setStatus('Camera/microphone permission was denied or unavailable.');
  }
}

async function acceptCall() {
  if (!pendingCaller) return;
  peerId = pendingCaller;
  incomingCall.hidden = true;

  try {
    localStream = await requestMedia(callType);
    localVideo.srcObject = localStream;
    callCard.hidden = false;
    createPeerConnection(peerId);
    socket.emit('accept-call', { to: peerId });
    setStatus(`Connected to ${peerId}. Waiting for WebRTC offer...`);
  } catch (error) {
    console.error(error);
    setStatus('Camera/microphone permission was denied or unavailable.');
    pendingCaller = null;
  }
}

function rejectCall() {
  if (pendingCaller) socket.emit('reject-call', { to: pendingCaller });
  pendingCaller = null;
  incomingCall.hidden = true;
}

async function createOffer() {
  if (!peerConnection || !peerId) return;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { to: peerId, offer });
}

async function handleOffer({ from, offer }) {
  peerId = from;
  if (!peerConnection) {
    localStream = await requestMedia(callType);
    localVideo.srcObject = localStream;
    callCard.hidden = false;
    createPeerConnection(peerId);
  }

  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { to: peerId, answer });
  setStatus(`In call with ${peerId}`);
}

async function handleAnswer({ answer }) {
  if (peerConnection) await peerConnection.setRemoteDescription(answer);
}

async function handleIceCandidate({ candidate }) {
  if (peerConnection && candidate) {
    try {
      await peerConnection.addIceCandidate(candidate);
    } catch (error) {
      console.warn('Unable to add ICE candidate:', error);
    }
  }
}

function cleanupCall(notifyPeer = true) {
  if (notifyPeer && peerId) socket.emit('end-call', { to: peerId });
  peerConnection?.close();
  peerConnection = null;
  localStream?.getTracks().forEach(track => track.stop());
  localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  callCard.hidden = true;
  pendingCaller = null;
  incomingCall.hidden = true;
  setStatus(myId ? 'Online' : 'Offline');
}

registerBtn.addEventListener('click', () => {
  const value = myIdInput.value.trim();
  if (!value) return setStatus('Enter your user ID.');
  myId = value;
  socket.emit('register', myId);
});

videoCallBtn.addEventListener('click', () => startCall('video'));
audioCallBtn.addEventListener('click', () => startCall('audio'));
acceptBtn.addEventListener('click', acceptCall);
rejectBtn.addEventListener('click', rejectCall);
endBtn.addEventListener('click', () => cleanupCall(true));

muteBtn.addEventListener('click', () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteBtn.textContent = track.enabled ? '🎤 Mute' : '🔇 Unmute';
});

cameraBtn.addEventListener('click', () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraBtn.textContent = track.enabled ? '📷 Camera Off' : '🚫 Camera On';
});

socket.on('registered', ({ userId }) => {
  setStatus(`Online as ${userId}`);
  videoCallBtn.disabled = false;
  audioCallBtn.disabled = false;
  registerBtn.disabled = true;
  myIdInput.disabled = true;
});

socket.on('incoming-call', ({ from, callType: type }) => {
  pendingCaller = from;
  callType = type;
  incomingText.textContent = `${from} is calling you (${type}).`;
  incomingCall.hidden = false;
});

socket.on('call-accepted', async ({ from }) => {
  peerId = from;
  await createOffer();
  setStatus(`Connecting to ${peerId}...`);
});

socket.on('call-rejected', ({ from }) => {
  cleanupCall(false);
  setStatus(`${from} rejected the call.`);
});

socket.on('call-failed', ({ reason }) => {
  cleanupCall(false);
  setStatus(reason || 'Call failed.');
});

socket.on('offer', handleOffer);
socket.on('answer', handleAnswer);
socket.on('ice-candidate', handleIceCandidate);

socket.on('call-ended', () => {
  cleanupCall(false);
  setStatus('The other user ended the call.');
});
