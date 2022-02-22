const { encode } = require('shared/util/encoder');
const storage = require('./storage');

module.exports = async function onPing(ws, action) {
    let clientTime = action.payload;
    let serverTime = (new Date()).getTime();
    let offset = serverTime - clientTime;
    let playerCount = storage.getPlayerCount();
    let response = { type: 'pong', payload: { offset, serverTime }, playerCount }
    ws.send(encode(response), true, false);
    return null;
}