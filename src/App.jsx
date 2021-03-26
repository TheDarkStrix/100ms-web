import React from 'react';
import { Layout, Modal, notification, Spin, Button, Input } from 'antd';
const { confirm } = Modal;
const { Header, Content, Sider } = Layout;
import { reactLocalStorage } from 'reactjs-localstorage';
import MediaSettings from './settings';
import ChatFeed from './chat/index';
import Message from './chat/message';
import bLogo from '../public/logo-blue-dark.svg';
import '../styles/css/app.scss';

import LoginForm from './LoginForm';
import Conference from './Conference';
import { HMSClient, HMSPeer, HMSClientConfig } from '@100mslive/hmsvideo-web';
import { dependencies } from '../package.json';

const sdkVersion = dependencies['@100mslive/hmsvideo-web'].substring(1);
console.info(
  `%c[APP] Using hmsvideo-web SDK version ${sdkVersion}`,
  'color:#268bd2'
);

async function getToken({ room_id, user_name, role = 'guest', env }) {
  const endpoint = `${process.env.TOKEN_ENDPOINT}?api=token`;
  const { token } = await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({ room_id, user_name, env, role }),
  })
    .then(response => response.json())
    .catch(err => console.log('Error client token: ', err));
  return token;
}

class App extends React.Component {
  constructor(props) {
    super(props);
    this.client = null;
    this.isConnected = false;
    this.state = {
      pollResult: [[], []],
      pollData: '',
      pollOpen: false,
      isCreatePollVisible: false,
      isPollVisible: false,
      login: false,
      isHost: false,
      loading: false,
      localAudioEnabled: true,
      localVideoEnabled: true,
      screenSharingEnabled: false,
      collapsed: true,
      isFullScreen: false,
      vidFit: false,
      loginInfo: {},
      messages: [],
      allpeers: [],
    };

    this._settings = {
      selectedAudioDevice: '',
      selectedVideoDevice: '',
      resolution: 'qvga',
      bandwidth: 256,
      codec: 'VP8',
      frameRate: 20,
      isDevMode: true,
    };

    let settings = reactLocalStorage.getObject('settings');
    if (settings.codec !== undefined) {
      this._settings = { ...this._settings, ...settings };
    }
  }

  _cleanUp = async () => {
    window.history.pushState({}, '100ms', `${window.location.href}`);
    await this.conference.cleanUp();
    await this.client.disconnect();
    this.client = null;
    this.isConnected = false;
    this.setState({
      login: false,
    });
  };

  _notification = (message, description) => {
    notification.info({
      message: message,
      description: description,
      placement: 'bottomRight',
    });
  };

  _createClient = async ({ userName, env, roomId, role }) => {
    let url = process.env.HMS_ENDPOINT;
    let authToken = await getToken({
      env,
      room_id: roomId,
      user_name: userName,
      // set the role to host
      // person creating the meeting is the HOST
      role: 'Host',
    });

    console.log(`%c[APP] TOKEN IS: ${authToken}`, 'color: orange');

    try {
      let peer = new HMSPeer(userName, authToken);

      let config = new HMSClientConfig({
        endpoint: url,
      });

      this.state.allpeers.push(peer);
      console.log('pushed host peer to all peers', peer);
      if (role === 'Host') this.setState({ isHost: true });
      return new HMSClient(peer, config);
    } catch (err) {
      console.error('ERROR: ', err);
      alert('Invalid token');
    }
  };

  _handleJoin = async values => {
    this.setState({ loading: true });
    let settings = this._settings;
    this.roomName = values.roomName;
    this.roomId = values.roomId;
    this.hideMessage = () => {};
    settings.selectedVideoDevice = values.selectedVideoDevice;
    settings.selectedAudioDevice = values.selectedAudioDevice;
    //TODO this should reflect in initialization as well

    this._onMediaSettingsChanged(
      settings.selectedAudioDevice,
      settings.selectedVideoDevice,
      settings.resolution,
      settings.bandwidth,
      settings.codec,
      settings.frameRate,
      settings.isDevMode
    );

    let client = await this._createClient({
      userName: values.displayName,
      roomId: values.roomId,
      role: values.role,
    });
    client.connect().catch(error => {
      alert(error.message);
    });

    window.onunload = async () => {
      await this._cleanUp();
    };

    client.on('peer-join', (room, peer) => {
      this.state.allpeers.push(peer);
      console.log('NEW PEER JOINED', peer);
      this._notification('Peer Join', `peer => ${peer.name} joined ${room}!`);
    });

    client.on('peer-leave', (room, peer) => {
      this._notification('Peer Leave', `peer => ${peer.name} left ${room}!`);
    });

    client.on('connect', () => {
      console.log('on connect called');
      if (this.isConnected) return;
      console.log('connected!');
      this._handleTransportOpen(values);
    });

    client.on('disconnect', () => {
      console.log('disconnected!');
      this.setState({
        loading: false,
      });
    });

    client.on('stream-add', (room, streamInfo) => {
      console.log('stream-add %s,%s!', room, streamInfo.mid);
    });

    client.on('stream-remove', (room, streamInfo) => {
      console.log(`stream-remove: ${room}, ${streamInfo.mid}`);
    });

    client.on('broadcast', (room, peer, message) => {
      console.log('broadcast: ', room, peer.name, message);
      this._onMessageReceived(peer.name, message);
    });

    client.on('disconnected', async () => {
      console.log(`%c[APP] TEARING DOWN`, 'color:#fc0');
      // @NOTE: Implement a cleaner tear down logic for graceful UI transition instead of a page reload
      location.reload();
    });

    this.client = client;
  };

  _handleTransportOpen = async values => {
    this.isConnected = true;
    reactLocalStorage.remove('loginInfo');
    reactLocalStorage.setObject('loginInfo', values);
    try {
      await this.client.join(values.roomId);
      //TODO ugly hack
      let redirectURL = `/?room=${values.roomId}&role=${values.role}`;
      window.history.pushState({}, '100ms', redirectURL);
      this.setState({
        login: true,
        loading: false,
        loginInfo: values,
        localVideoEnabled: !values.audioOnly,
        localAudioEnabled: !values.videoOnly,
      });

      this._notification(
        'Connected!',
        'Welcome to the 100ms room => ' + values.roomId
      );
      await this.conference.handleLocalStream(true);
    } catch (error) {
      console.error('HANDLE THIS ERROR: ', error);
    }
  };

  _handleLeave = async () => {
    let client = this.client;
    let this2 = this;
    confirm({
      title: 'Leave Now?',
      content: 'Do you want to leave the room?',
      async onOk() {
        await this2._cleanUp();
        this2.setState({ login: false });
      },
      onCancel() {
        console.log('Cancel');
      },
    });
  };

  _handleAudioTrackEnabled = enabled => {
    this.setState({
      localAudioEnabled: enabled,
    });
    this.conference.muteMediaTrack('audio', enabled);
  };

  _handleVideoTrackEnabled = enabled => {
    this.setState({
      localVideoEnabled: enabled,
    });
    this.conference.muteMediaTrack('video', enabled);
  };

  _handleScreenSharing = enabled => {
    this.setState({
      screenSharingEnabled: enabled,
    });
    this.conference.handleScreenSharing(enabled);
  };

  _onRef = ref => {
    this.conference = ref;
  };

  _openOrCloseLeftContainer = collapsed => {
    this.setState({
      collapsed: collapsed,
    });
  };

  _onVidFitClickHandler = () => {
    this.setState({
      vidFit: !this.state.vidFit,
    });
  };

  _onFullScreenClickHandler = () => {
    let docElm = document.documentElement;

    if (this._fullscreenState()) {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }

      this.setState({ isFullScreen: false });
    } else {
      if (docElm.requestFullscreen) {
        docElm.requestFullscreen();
      }
      //FireFox
      else if (docElm.mozRequestFullScreen) {
        docElm.mozRequestFullScreen();
      }
      //Chrome等
      else if (docElm.webkitRequestFullScreen) {
        docElm.webkitRequestFullScreen();
      }
      //IE11
      else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }

      this.setState({ isFullScreen: true });
    }
  };

  _fullscreenState = () => {
    return (
      document.fullscreen ||
      document.webkitIsFullScreen ||
      document.mozFullScreen ||
      false
    );
  };

  _onMediaSettingsChanged = (
    selectedAudioDevice,
    selectedVideoDevice,
    resolution,
    bandwidth,
    codec,
    frameRate,
    isDevMode,
    reloadPage = false
  ) => {
    this._settings = {
      selectedAudioDevice,
      selectedVideoDevice,
      resolution,
      bandwidth,
      codec,
      frameRate,
      isDevMode,
    };
    reactLocalStorage.setObject('settings', this._settings);
    const constraints = {
      frameRate: frameRate,
      bitrate: bandwidth,
      resolution: resolution,
      advancedMediaConstraints: {
        audio: {
          deviceId: selectedAudioDevice,
        },
        video: {
          deviceId: selectedVideoDevice,
        },
      },
    };
    if (reloadPage) {
      this.client &&
        this.client.applyConstraints(constraints, this.client.local);
    }
  };

  _onMessageReceived = (from, message) => {
    console.log('Received message:' + from + ':' + message);
    const messageData = message.split(':');
    switch (messageData[0]) {
      case 'msg':
        let messages = this.state.messages;
        let uid = 1;
        messages.push(
          new Message({ id: uid, message: message, senderName: from })
        );
        this.setState({ messages });
        break;
      case 'handRaise':
        if (this.state.isHost) this._notification('Hand Raised by ' + from);
        break;
      case 'pollCreate':
        console.log('poll created');
        console.log(message);
        this.setState({ pollData: message });
        this.setState({ isPollVisible: true });
        break;
      case 'pollVote':
        const data = message.split(':');
        console.log(data);
        let currentResult = this.state.pollResult;
        currentResult[parseInt(data[1])].push(from);
        console.log('currentResult', currentResult);
        this.setState({ pollResult: currentResult });
    }
  };

  _onPollVote = answer => {
    var info = {
      senderName: this.state.loginInfo.displayName,
      msg: 'pollVote:' + answer,
    };
    this.setState({ isPollVisible: false });
    this.client.broadcast(info, this.client.rid);
  };

  _onSendMessage = data => {
    console.log('Send message:' + data);
    var info = {
      senderName: this.state.loginInfo.displayName,
      msg: 'msg:' + data,
    };
    this.client.broadcast(info, this.client.rid);
    let messages = this.state.messages;
    let uid = 0;
    messages.push(new Message({ id: uid, message: data, senderName: 'me' }));
    this.setState({ messages });
  };

  _onCreatePoll = data => {
    console.log('Poll Create' + data);
    let pollData = 'pollCreate:' + data.question;
    data.answers.forEach(element => {
      pollData += ':' + element;
    });
    var info = {
      senderName: this.state.loginInfo.displayName,
      msg: pollData,
    };
    this.client.broadcast(info, this.client.rid);
  };

  _onRaiseHand = data => {
    console.log('Raise Hand' + data);
    var info = {
      senderName: this.state.loginInfo.displayName,
      msg: 'handRaise:',
    };
    this.client.broadcast(info, this.client.rid);
    //this.setState({ messages });
  };

  _handleSubmitCreatePoll = event => {
    event.preventDefault();
    this.setState({ pollOpen: true });
    console.log(
      'handleFORM',
      this.state.question,
      this.state.answer1,
      this.state.answer2
    );
    this._onCreatePoll({
      question: this.state.question,
      answers: [this.state.answer1, this.state.answer2],
    });
    //dont close the poll
    //    this.setState({ isCreatePollVisible: false });
    this._notification('Poll Published');
  };

  _createPoll = () => {
    this.setState({
      isCreatePollVisible: !this.state.isCreatePollVisible,
    });
  };

  handleQuestion = e => {
    this.setState({ question: e.target.value });
  };

  handleAnswer1 = e => {
    this.setState({ answer1: e.target.value });
  };

  handleAnswer2 = e => {
    this.setState({ answer2: e.target.value });
  };

  _closeCreatedPoll = () => {
    this.setState({
      pollOpen: !this.state.pollOpen,
      isCreatePollVisible: !this.state.isCreatePollVisible,
      question: '',
      answer1: '',
      answer2: '',
      pollResult: [[], []],
      pollData: '',
    });
  };

  render() {
    const {
      login,
      loading,
      localAudioEnabled,
      localVideoEnabled,
      screenSharingEnabled,
      collapsed,
      vidFit,
    } = this.state;
    return (
      <Layout className="app-layout">
        <Header
          className="app-header"
          style={{
            backgroundColor: '#0B0F15',
            zIndex: '10',
            padding: '0 0',
            margin: '0 auto',
            width: '100%',
          }}
        >
          <div className="app-header-left">
            <a href="https://100ms.live/" target="_blank">
              <img src={bLogo} className="h-8" />
            </a>
          </div>
          <div className="app-header-right">
            <MediaSettings
              onMediaSettingsChanged={this._onMediaSettingsChanged}
              settings={this._settings}
              isLoggedIn={login}
            />
          </div>
        </Header>

        <Content className="app-center-layout">
          {login ? (
            <Layout className="app-content-layout">
              <Sider
                width={320}
                collapsedWidth={0}
                trigger={null}
                collapsible
                collapsed={this.state.collapsed}
                style={{ backgroundColor: '#0B0F15' }}
              >
                <div className="left-container">
                  <ChatFeed
                    messages={this.state.messages}
                    onSendMessage={this._onSendMessage}
                  />
                </div>
              </Sider>
              <Layout className="app-right-layout">
                <Content style={{ flex: 1, position: 'relative' }}>
                  <div>
                    <Conference
                      createPoll={this._createPoll}
                      roomName={this.roomName}
                      roomId={this.roomId}
                      isHost={this.state.isHost}
                      collapsed={this.state.collapsed}
                      client={this.client}
                      settings={this._settings}
                      localAudioEnabled={localAudioEnabled}
                      localVideoEnabled={localVideoEnabled}
                      vidFit={vidFit}
                      loginInfo={this.state.loginInfo}
                      onHandRaised={this._onRaiseHand}
                      ref={ref => {
                        this.conference = ref;
                      }}
                      isScreenSharing={screenSharingEnabled}
                      onScreenToggle={() =>
                        this._handleScreenSharing(!screenSharingEnabled)
                      }
                      onLeave={this._handleLeave}
                      onChatToggle={() =>
                        this._openOrCloseLeftContainer(!collapsed)
                      }
                      isChatOpen={!this.state.collapsed}
                      cleanUp={this._cleanUp}
                    />
                  </div>
                </Content>
              </Layout>
            </Layout>
          ) : loading ? (
            <Spin size="large" tip="Connecting..." />
          ) : (
            <div className="relative w-full mt-16">
              <LoginForm
                handleLogin={this._handleJoin}
                createClient={this._createClient}
              />
            </div>
          )}
          <Modal
            visible={this.state.isPollVisible}
            title={'Poll'}
            footer={[
              <Button
                key="submit"
                type="primary"
                onClick={() =>
                  this.setState({ isPollVisible: !this.state.isPollVisible })
                }
              >
                Close Poll
              </Button>,
            ]}
          >
            <div>Question : {this.state.pollData.split(':')[1]}</div>
            <Button
              type="primary"
              style={{ margin: '1em 1em 1em  0' }}
              onClick={() => this._onPollVote(0)}
            >
              {this.state.pollData.split(':')[2]}
            </Button>
            <Button type="primary" onClick={() => this._onPollVote(1)}>
              {this.state.pollData.split(':')[3]}
            </Button>
          </Modal>
          {/* create poll */}
          <Modal
            visible={this.state.isCreatePollVisible}
            title={'Create Poll'}
            footer={[
              <Button
                key="submit"
                type="primary"
                onClick={
                  !this.state.pollOpen
                    ? this._handleSubmitCreatePoll
                    : this._closeCreatedPoll
                }
              >
                {!this.state.pollOpen ? 'Create Poll' : 'Close Poll'}
              </Button>,
            ]}
          >
            <Input
              placeholder="Enter question"
              type="text"
              style={{ margin: '1em 0' }}
              value={this.state.question}
              onChange={this.handleQuestion}
            />
            <Input
              placeholder="Answer 1"
              style={{ margin: '1em 0' }}
              type="text"
              value={this.state.answer1}
              onChange={this.handleAnswer1}
            />
            <Input
              placeholder="Answer 2"
              style={{ margin: '1em 0' }}
              type="text"
              value={this.state.answer2}
              onChange={this.handleAnswer2}
            />
            <div>
              Results : <br />
              Answer 1 : {this.state.pollResult[0].length}
              <br />
              Answer 2 : {this.state.pollResult[1].length}
            </div>
          </Modal>
        </Content>
      </Layout>
    );
  }
}

export default App;
