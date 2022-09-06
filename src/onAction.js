const JoinAction = require('./onJoin');
const onLeave = require('./onLeave');
const onSkip = require('./onSkip');
const onPing = require('./onPing');

const ChatManager = require('./ChatManager');

const { decode } = require('shared/util/encoder');

const mq = require('shared/services/rabbitmq');
const storage = require('./storage');
const profiler = require('shared/util/profiler');

const PublicAction = require('./PublicAction');

// console.log = () => { };

class Action {

    constructor() {

        this.publicActions = {};
        this.publicActions['getGameQueues'] = PublicAction.getGameQueues.bind(PublicAction);
        this.publicActions['getGameDaily'] = PublicAction.getGameDaily.bind(PublicAction);
        this.publicActions['getGameWeekly'] = PublicAction.getGameWeekly.bind(PublicAction);
        this.publicActions['getGameMonthly'] = PublicAction.getGameMonthly.bind(PublicAction);
        this.publicActions['getGameAllTime'] = PublicAction.getGameAllTime.bind(PublicAction);

        this.system = {};
        this.system['joinqueues'] = JoinAction.onJoinQueues.bind(JoinAction);
        this.system['joingame'] = JoinAction.onJoinGame.bind(JoinAction);
        this.system['joinroom'] = JoinAction.onJoinRoom.bind(JoinAction);
        this.system['leavequeue'] = JoinAction.onLeaveQueue.bind(JoinAction);
        this.system['ping'] = onPing;
        this.system['chat'] = ChatManager.onChatSend.bind(ChatManager);

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


        if (!unsafeAction || !unsafeAction.type || typeof unsafeAction.type !== 'string') {

            console.error("Invalid action received from: [" + ws.user.shortid + "]", unsafeAction);
            return;
        }


        console.log("Receiving decoded from Client: [" + ws.user.shortid + "]", unsafeAction);

        let action = {};
        action.type = unsafeAction.type;
        action.payload = unsafeAction.payload;
        action.timeseq = unsafeAction.timeseq;

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

        let next = roomState?.next;
        if (!next)
            return false;


        if (action.type == 'ready') {
            action.payload = true; //force payload, incase someone tries to send something
            return true;
        }

        let userid = action.user.id;
        let nextid = next?.id;
        let teams = roomState?.teams;

        let passed = this.validateNextUser(userid, nextid, teams);
        if (passed) {
            if (roomState?.timer?.seq != action.timeseq) {
                JoinAction.subscribeToRoom(ws, action.room_slug, roomState);
                console.error("User failed seq validation: ", roomState.timer, roomState.next);
                return false;
            }
            return true;
        }

        console.log("User failed validation: ", action);
        return false;
    }

    validateNextUser(userid, nextid, teams) {

        if (typeof nextid === 'string') {
            //anyone can send actions
            if (nextid == '*')
                return true;

            //only specific user can send actions
            if (nextid == userid)
                return true;

            //validate team has players
            if (!teams || !teams[nextid] || !teams[nextid].players)
                return false;

            //allow players on specified team to send actions
            if (Array.isArray(teams[nextid].players) && teams[nextid].players.includes(userid)) {
                return true;
            }
        }
        else if (Array.isArray(nextid)) {

            //multiple users can send actions if in the array
            if (nextid.includes(userid))
                return true;

            //validate teams exist
            if (!teams)
                return false;

            //multiple teams can send actions if in the array
            for (var i = 0; i < nextid.length; i++) {
                let teamid = nextid[i];
                if (Array.isArray(teams[teamid].players) && teams[teamid].players.includes(userid)) {
                    return true;
                }
            }
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