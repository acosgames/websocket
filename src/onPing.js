const { encode } = require('shared/util/encoder');

module.exports = async function onPing(ws, action) {
    let clientTime = action.payload;
    let serverTime = (new Date()).getTime();
    let offset = serverTime - clientTime;
    let response = { type: 'pong', payload: { offset, serverTime } }
    ws.send(encode(response), true, false);
    return null;
}