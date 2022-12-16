import env from "./derived/env";
import { log } from "./util";

const bridgeUrl = `${env.MVP_SERVER}/bridge?v=5`;

// The different types of message that we send/receive over the iframe bridge.
// TODO we define this in multiple codebases.
export enum MessageType {
  Config = "CONFIG",
  ShowModal = "SHOW_MODAL",
  HideModal = "HIDE_MODAL",
  Passthrough = "PASSTHROUGH",
  Analytics = "ANALYTICS",
  ShowSidebar = "SHOW_SIDEBAR",
  HideSidebar = "HIDE_SIDEBAR",
  SidebarOpened = "SIDEBAR_OPENED",
  SidebarClosed = "SIDEBAR_CLOSED",
  LogoClick = "LOGO_CLICK",
  OpenMeeting = "OPEN_MEETING",
  StaticPopupOpened = "STATIC_POPUP_OPENED",
  StaticPopupClosed = "STATIC_POPUP_CLOSED",
  CreatePopupOpened = "CREATE_POPUP_OPENED",
  CreatePopupCanceled = "CREATE_POPUP_CANCELED",
  CreatePopupSaved = "CREATE_POPUP_SAVED",
  CreatePageOpened = "CREATE_PAGE_OPENED",
  CreatePageCanceled = "CREATE_PAGE_CANCELED",
  CreatePageSaved = "CREATE_PAGE_SAVED",
  EditPageOpened = "EDIT_PAGE_OPENED",
  EditPageCanceled = "EDIT_PAGE_CANCELED",
  EditPageSaved = "EDIT_PAGE_SAVED",
  FinishLogin = "FINISH_LOGIN"
};

class Bridge {
  config: Record<string, any>;
  queuedEvents: Array<Array<any>>;
  bridge: HTMLIFrameElement;
  modalWrap: HTMLElement;
  modal: HTMLIFrameElement;
  sidebarWrap: HTMLElement;
  sidebar: HTMLIFrameElement;
  initCallback: () => void;

  constructor() {
    this.config = null;
    this.queuedEvents = [];
    this.bridge = null;
    this.modalWrap = null;
    this.modal = null;
    this.sidebarWrap = null;
    this.sidebar = null;

    // Add bridge iframe - this hosts the other side of the bridge, pulled down from our server.
    this.bridge = document.createElement('iframe');
    this.bridge.src = bridgeUrl;
    this.bridge.setAttribute('id', 'miter_bridge');
    this.bridge.style.display = 'none';
    document.body.appendChild(this.bridge);

    // Set up listener for messages coming across the bridge.
    window.addEventListener('message', (evt) => {
      if (evt.data && evt.data.miter) {
        log(`Got a ${evt.data.type} message from the bridge`);
        switch (evt.data.type) {

          case MessageType.Config:
            // Receive initial config object after loading the server-hosted side of the bridge.
            this.config = evt.data.payload;

            if (this.initCallback) this.initCallback();
            else console.error("Instantiated bridge without init callback.");

            // Have we queued up any analytics events prior to the bridge loading? Send them off now.
            this.queuedEvents.forEach(e => {
              this.track(e[0], e[1]);
            });
            this.queuedEvents = [];

            break;

          // Modal iframe--used to host server-hosted login flow.
          case MessageType.ShowModal:
            this.showModal(evt.data.payload.url, evt.data.payload.width, evt.data.payload.height);
            break;
          case MessageType.HideModal:
            if (this.modal) {
              this.modalWrap.style.display = "none";
            }
            break;

          // Sidebar iframe--used to host React app
          case MessageType.ShowSidebar:
            this.showSidebar(evt.data.payload.url);
            this.sendMessage(MessageType.SidebarOpened, { url: evt.data.payload.url });
            break;
          case MessageType.HideSidebar:
            this.hideSidebar();
            this.sendMessage(MessageType.SidebarClosed);
            break;

          case MessageType.Passthrough:
            // Pass a message to one of our other iframes.
            // Payload should contain the message to pass, with a `destination` field.
            // Not currently used (and TODO maybe we should kill it).
            this.sendMessage(evt.data.payload.type, evt.data.payload.payload, evt.data.payload.destination);
            break;

          case MessageType.FinishLogin:
            this.sendMessage(MessageType.FinishLogin);
            break;

        }
      }
    });
  }

  setInitCallback = cb => {
    this.initCallback = cb;
  };

  showModal = (url, width, height) => {
    if (!this.modal) {
      this.modal = document.createElement('iframe');
      const modalChrome = document.createElement('div');
      modalChrome.className = "MiterModal";
      modalChrome.appendChild(this.modal);
      this.modalWrap = document.createElement('div');
      this.modalWrap.className = "MiterModalWrap";
      this.modalWrap.appendChild(modalChrome);
      document.body.appendChild(this.modalWrap);
      this.modalWrap.addEventListener('click', () => { this.modalWrap.style.display = "none"; });
    }
    this.modalWrap.style.display = null;
    this.modal.style.width = `${width || 640}px`;
    this.modal.style.height = `${height || 480}px`;
    this.modal.src = url;
  };

  showSidebar = (url: string) => {
    if (!this.sidebarWrap) {
      this.sidebarWrap = document.createElement('div');
      this.sidebarWrap.className = "MiterSidebarWrap Hide";
      document.querySelector(this.config.sel.TopContainer).appendChild(this.sidebarWrap);
    }

    if (this.sidebar) {
      // TODO working around an incredibly weird bug that occurs when we simply change the URL of an existing
      // sidebar iframe. Under those circumstances, when you (1) hit the Open in Miter button from the static
      // GCal popup (but not the full GCal edit screen), then (2) click another event to reflect it in the 
      // static GCal popup without first closing it, then (3) click Open in Miter from _that_ popup, then
      // (4) close the static GCal popup, the sidebar reverts to the event you opened in (1). Just to make
      // it more confusing, the Web Inspector shows the iframe's src attribute to be
      // the event you opened second, but the app inside the iframe recognizes its own window.href to be
      // the first event you opened (as reflected) by its own content. Since I kinda hit a dead end
      // trying to figure out what the hell is happening and a workaround does exist (destroy and recreate
      // the iframe), that's what I'm doing.
      this.sidebar.remove();
      this.sidebar = null;
    }

    this.sidebar = document.createElement('iframe');
    this.sidebar.setAttribute('allow', 'clipboard-write');
    this.sidebarWrap.appendChild(this.sidebar);
    this.sidebar.src = url;
    window.setTimeout(() => {
      // Animate in
      this.sidebarWrap.classList.remove('Hide');
      document.body.classList.add('HasMiterSidebar');
    }, 0);
  };

  hideSidebar = () => {
    // Animate out
    this.sidebarWrap.classList.add('Hide');
    document.body.classList.remove('HasMiterSidebar');
    if (this.sidebar) {
      window.setTimeout(() => {
        // TODO If I'm able to fix the bug above, maybe don't destroy the sidebar anymore. Or maybe do.
        this.sidebar.remove();
        this.sidebar = null;
      }, 1000);
    }
  };

  sendMessage = (type: MessageType, payload: Record<string, any> = {}, destination: string = "bridge") => {
    let destElement = (destination === "modal") ? this.modal : this.bridge;
    destElement.contentWindow.postMessage({ type: type, payload: payload, miter: true }, '*');
  };

  track = (eventName, properties) => {
    log(eventName);
    if (this.config) {
      this.sendMessage(MessageType.Analytics, { command: 'TRACK', name: eventName, properties: properties || {} });
    } else {
      this.queuedEvents.push([eventName, properties]);
    }
  };

}

export default new Bridge();
