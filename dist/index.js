import axios from 'axios';
import credutil from 'shared/util/credentials.js';
import WSNode from './src/ws.js';
import ChatManager from './src/ChatManager.js';
import RoomUpdate from './src/onRoomUpdate.js';
axios.interceptors.response.use(response => {
    return response;
}, error => {
    if (!error.response) {
        console.log("Waiting on api to be online...");
    }
    return Promise.reject(error);
});
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function start() {
    let credentials = credutil();
    let url = credentials.platform.api.url;
    while (true) {
        try {
            let response = await axios.get(url);
            if (response)
                break;
        }
        catch (e) { }
        await sleep(2000);
    }
    await WSNode.connect();
    RoomUpdate.setup();
    ChatManager.start();
    console.log("[WebSocket] STARTED @ " + (new Date()).toString());
}
start();
process.on('SIGINT', function () {
    console.log('SIGINT');
    process.exit();
});
//# sourceMappingURL=index.js.map