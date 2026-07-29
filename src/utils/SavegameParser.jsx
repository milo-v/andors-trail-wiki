class Reader {
    constructor(buffer) {
        this.view = new DataView(buffer);
        this.pos = 0;
    }
    int() {
        const v = this.view.getInt32(this.pos, false);
        this.pos += 4;
        return v;
    }
    long() {
        const v = this.view.getBigInt64(this.pos, false);
        this.pos += 8;
        return v;
    }
    bool() {
        const v = this.view.getUint8(this.pos) !== 0;
        this.pos += 1;
        return v;
    }
    float() {
        const v = this.view.getFloat32(this.pos, false);
        this.pos += 4;
        return v;
    }
    utf() {
        const length = this.view.getUint16(this.pos, false);
        this.pos += 2;
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length);
        this.pos += length;
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function readRange(r) {
    r.int();
    r.int();
}

function readCoord(r) {
    r.int();
    r.int();
}

function readConditions(r) {
    const n = r.int();
    for (let i = 0; i < n; i++) {
        r.utf();
        r.int();
        r.int();
    }
}

function readItemContainer(r) {
    const n = r.int();
    for (let i = 0; i < n; i++) {
        r.utf();
        r.int();
    }
}

function readMonster(r) {
    r.utf();
    const hasCustomTraits = r.bool();
    if (hasCustomTraits) {
        r.int();
        r.int();
        r.int();
        r.float();
        readRange(r);
        r.int();
        r.int();
    }
    readRange(r);
    readRange(r);
    readCoord(r);
    readConditions(r);
    r.int();
    r.bool();
    const hasShopItems = r.bool();
    if (hasShopItems) readItemContainer(r);
}

function readSpawnArea(r) {
    r.bool();
    const n = r.int();
    for (let i = 0; i < n; i++) readMonster(r);
}

function readMap(r) {
    const shouldSaveMapData = r.bool();
    if (shouldSaveMapData) {
        const n = r.int();
        for (let i = 0; i < n; i++) {
            r.utf();
            readSpawnArea(r);
        }
        const ng = r.int();
        for (let i = 0; i < ng; i++) r.utf();
        const nb = r.int();
        for (let i = 0; i < nb; i++) {
            r.int();
            r.int();
            readItemContainer(r);
            readCoord(r);
            r.bool();
        }
        const hasFilter = r.bool();
        if (hasFilter) r.utf();
        r.long();
    }
    r.bool();
    r.utf();
}

function readInterface(r) {
    r.bool();
    r.bool();
    const hasPos = r.bool();
    if (hasPos) readCoord(r);
    r.utf();
}

function readStatistics(r) {
    r.int();
    const nm = r.int();
    for (let i = 0; i < nm; i++) {
        r.utf();
        r.int();
    }
    const ni = r.int();
    const usedItems = new Map();
    for (let i = 0; i < ni; i++) {
        const itemID = r.utf();
        const count = r.int();
        usedItems.set(itemID, count);
    }
    r.int();
    r.int();
    r.bool();
    r.bool();
    const clen = r.int();
    r.pos += clen;
    return { usedItems };
}

function readPlayer(r) {
    const p = {};
    r.int();
    r.int();
    r.int();
    r.int();
    p.name = r.utf();
    r.int();
    r.int();
    r.int();
    r.int();
    r.float();
    readRange(r);
    r.int();
    r.int();
    r.int();
    readRange(r);
    readRange(r);
    readCoord(r);
    readConditions(r);
    readConditions(r);
    readCoord(r);
    readCoord(r);
    p.level = r.int();
    p.totalExperience = r.int();

    readItemContainer(r);
    r.int();
    const nw = r.int();
    for (let i = 0; i < nw; i++) {
        if (r.bool()) r.utf();
    }
    const nq = r.int();
    for (let i = 0; i < nq; i++) {
        if (r.bool()) r.utf();
    }

    r.int();
    r.int();
    const ns = r.int();
    for (let i = 0; i < ns; i++) {
        r.int();
        r.int();
    }
    r.utf();
    r.utf();

    const nquests = r.int();
    const questProgress = new Map();
    for (let i = 0; i < nquests; i++) {
        const qid = r.utf();
        const npg = r.int();
        const progress = new Set();
        for (let j = 0; j < npg; j++) progress.add(r.int());
        questProgress.set(qid, progress);
    }
    p.questProgress = questProgress;

    r.int();
    const na = r.int();
    const alignments = new Map();
    for (let i = 0; i < na; i++) {
        const faction = r.utf();
        const value = r.int();
        alignments.set(faction, value);
    }
    p.alignments = alignments;

    p.id = r.utf();
    p.savedVersion = r.long();
    return p;
}

export function parseSavegame(arrayBuffer) {
    const r = new Reader(arrayBuffer);
    const header = {};
    header.fileversion = r.int();
    if (header.fileversion < 81) {
        throw new Error(`Unrecognized savegame file (fileversion ${header.fileversion})`);
    }
    header.playerName = r.utf();
    r.utf();
    r.int();
    r.bool();
    r.bool();
    header.playerId = r.utf();
    r.long();
    r.bool();

    const nmaps = r.int();
    for (let i = 0; i < nmaps; i++) {
        r.utf();
        readMap(r);
    }

    const player = readPlayer(r);
    r.utf();
    readInterface(r);
    const statistics = readStatistics(r);
    const usedBonemealPotions = (statistics.usedItems.get('bonemeal_potion') || 0) + (statistics.usedItems.get('pot_bm_lodar') || 0);

    return { header, player, usedBonemealPotions };
}
