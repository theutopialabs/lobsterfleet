// Minimal types for noVNC's RFB. The package ships no declarations, so we type
// just the bits we touch in VncViewerPage.
declare module "@novnc/novnc" {
  export interface RFBOptions {
    credentials?: { username?: string; password?: string; target?: string };
    shared?: boolean;
    wsProtocols?: string[];
  }
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    scaleViewport: boolean;
    background: string;
    viewOnly: boolean;
    disconnect(): void;
  }
}
