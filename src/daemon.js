// Thin wrapper over the background relay: every daemon call is a runtime
// message that background.js forwards to the native host via sendNativeMessage.
export function send(message) {
  return browser.runtime.sendMessage(message);
}
