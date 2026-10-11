export function admitsRendererRequest(event, webContents, allowedUrl) {
  const frame = event?.senderFrame;
  return (
    event?.sender === webContents &&
    frame &&
    frame === event.sender.mainFrame &&
    allowedUrl(frame.url)
  );
}

export function acceptsNoIpcArguments(args) {
  return args.length === 0;
}
