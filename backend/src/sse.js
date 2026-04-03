function openSseStream(req, res, { keepAliveMs = 15_000 } = {}) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) {
      res.write(': ping\n\n');
    }
  }, keepAliveMs);

  if (typeof heartbeat.unref === 'function') {
    heartbeat.unref();
  }

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
  };

  req.on('close', close);
  res.on('close', close);

  return {
    send(payload) {
      if (!closed && !res.writableEnded) {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }
    },
    close,
  };
}

module.exports = {
  openSseStream,
};
