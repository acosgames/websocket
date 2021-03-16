
const ByteBuffer = require('bytebuffer');

function encodeValue(json, buff) {

}

function encode(json, buff) {
    var doFlip = false;
    if (!buf) {
        buf = new ByteBuffer();
        doFlip = true;
    }
    var le = buf.littleEndian;
    try {
        encodeValue(json, buf.LE());
        buf.littleEndian = le;
        return doFlip ? buf.flip() : buf;
    } catch (e) {
        buf.littleEndian = le;
        throw (e);
    }
}

function decode(json) {

}

function test() {
    let payload = { "state": { "deck": [] }, "errors": "", "hands": [[{ "rank": 7, "score": 10, "name": "Straight", "hand": "6H,7H,WW,9H,TS", "player": "Tim", "chips": 99 }]] };

    let encoded = encode(json);
    console.log(encoded.length);
}