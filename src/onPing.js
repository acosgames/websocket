const { encode } = require('fsg-shared/util/encoder');

module.exports = async function processPing(ws, message) {
    let clientTime = message.payload;
    let serverTime = (new Date()).getTime();
    let offset = serverTime - clientTime;
    let response = { type: 'pong', payload: { offset, serverTime } }
    ws.send(encode(response), true, false);
}