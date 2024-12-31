export const callbackHandler = (callback, timeout) => {
  let timer = null;
  let reply = null;
  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = null;
    reply = null;
  };
  
  timer = setTimeout(cleanup, timeout);
  
  return {
    reply: (message) => {
      reply = message;
      cleanup();
    },
    getReply: () => reply
  };
}; 