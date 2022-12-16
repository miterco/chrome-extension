chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    window.open("https://miter.co/chrome-postinstall?src=chromestore");
  }

  return false;
});
