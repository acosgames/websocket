const JoinAction = require('./onJoin');
const onLeave = require('./onLeave');
const onSkip = require('./onSkip');
const onPing = require('./onPing');

const { decode } = require('shared/util/encoder');

const mq = require('shared/services/rabbitmq');
const storage = require('./storage');
const profiler = require('shared/util/profiler');

// console.log = () => { };

class Action {

    constructor() {
        this.system = {};
        this.system['joingame'] = JoinAction.onJoinGame.bind(JoinAction);
        this.system['joinroom'] = JoinAction.onJoinRoom.bind(JoinAction);
        this.system['leavequeue'] = JoinAction.onLeaveQueue.bind(JoinAction);
        this.system['ping'] = onPing;

        // this.actions['spectate'] = JoinAction.onJoinSpectate.bind(JoinAction);
        this.actions = {};
        this.actions['leave'] = onLeave;
        this.actions['skip'] = onSkip; //handled by timer in gameserver, not used here
        this.actions['pregame'] = onSkip;
        this.actions['type'] = onSkip;
        this.actions['gamestart'] = onSkip;
        this.actions['gameover'] = onSkip;

    }

    async onClientAction(ws, message, isBinary) {
        profiler.StartTime('ActionUpdateLoop');
        // profiler.StartTime('OnClientAction');
        console.log("Receiving message from Client: [" + ws.user.shortid + "]");
        let unsafeAction = null;
        try {
            unsafeAction = decode(message)
        }
        catch (e) {
            console.error(e);
            return;
        }
        console.log("Receiving decoded from Client: [" + ws.user.shortid + "]", unsafeAction);

        if (!unsafeAction || !unsafeAction.type || typeof unsafeAction.type !== 'string')
            return;

        let action = {};
        action.type = unsafeAction.type;
        action.payload = unsafeAction.payload;
        action.seq = unsafeAction.seq;

        if (unsafeAction.room_slug) {
            action.room_slug = unsafeAction.room_slug;
        }

        action.user = { id: ws.user.shortid };


        // if (action.type == 'ping') {
        //     await onPing(ws, action);
        //     return;
        // }

        let systemAction = this.system[action.type];

        if (systemAction) {
            action = await systemAction(ws, action);
            return;
        }

        let roomState = await storage.getRoomState(action.room_slug);
        if (!roomState)
            return;

        if (roomState?.events?.gameover)
            return;

        let requestAction = this.actions[action.type];
        if (requestAction)
            action = await requestAction(ws, action);
        else
            action = await this.gameAction(ws, action);

        if (!action)
            return;

        await this.forwardAction(action);
        // profiler.EndTime('OnClientAction');
    }

    async gameAction(ws, action) {
        let room_slug = action.room_slug;
        if (!room_slug)
            return null;
        let meta = await storage.getRoomMeta(room_slug);
        if (!meta)
            return null;

        let roomState = await storage.getRoomState(room_slug);
        if (!roomState)
            return null;

        if (!this.validateUser(ws, roomState, action))
            return null;

        return action;
    }

    validateUser(ws, roomState, action) {
        //prevent users from sending actions if not their turn
        if (!roomState)
            return false;
        if (!roomState.next)
            return false;


        if (action.type == 'ready') {
            action.payload = true; //force payload, incase someone tries to send something
            return true;
        }

        if (roomState.next.id == '*' || roomState.next.id == ws.user.shortid) {
            if (roomState.timer.seq != action.seq) {
                JoinAction.subscribeToRoom(ws, action.room_slug, roomState);
                console.error("User failed validation: ", roomState.timer, roomState.next);
                return false;
            }
            return true;
        }



        return false;
    }

    async forwardAction(msg) {

        if (!msg.type) {
            console.error("Action is missing, ignoring message", msg);
            return;
        }

        let meta = await storage.getRoomMeta(msg.room_slug);
        var game_slug = meta.game_slug;
        if (!game_slug)
            return;

        try {
            // let exists = await mq.assertQueue(game_slug);
            // if (!exists) {
            //     await mq.publishQueue('loadGame', msg)
            // }
            let key = game_slug + '/' + msg.room_slug;
            await mq.publish('action', key, msg);
        }
        catch (e) {
            console.error(e);
        }
    }

}

module.exports = new Action();