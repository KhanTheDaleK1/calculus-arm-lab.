// Minimal STK500v1 flasher for ATmega328P (Arduino Uno) over Web Serial.
// Supports fetching an Intel HEX string and programming flash memory.

class STK500 {
    constructor(port, opts = {}) {
        this.port = port;
        this.debug = opts.debug ?? false;
    }

    log(msg) { if (this.debug) console.log(`[STK500] ${msg}`); }

    async reset() {
        // Toggle DTR to reset the Uno into the bootloader
        await this.port.setSignals({ dataTerminalReady: false });
        await delay(50);
        await this.port.setSignals({ dataTerminalReady: true });
        await delay(50);
    }

    async send(bytes) {
        const writer = this.port.writable.getWriter();
        await writer.write(new Uint8Array(bytes));
        writer.releaseLock();
    }

    async read(expected) {
        const reader = this.port.readable.getReader();
        let out = new Uint8Array(0);
        try {
            let attempts = 0;
            while (out.length < expected && attempts < 50) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    const merged = new Uint8Array(out.length + value.length);
                    merged.set(out);
                    merged.set(value, out.length);
                    out = merged;
                }
                attempts++;
                if (out.length < expected) await delay(10);
            }
        } finally {
            reader.releaseLock();
        }
        return out;
    }

    async sync() {
        for (let i = 0; i < 5; i++) {
            await this.send([0x30, 0x20]); // STK_GET_SYNC, CRC_EOP
            const resp = await this.read(2);
            if (resp.length >= 2 && resp[0] === 0x14 && resp[1] === 0x10) return true;
            await delay(50);
        }
        return false;
    }

    async enterProgMode() {
        await this.send([0x50, 0x20]); // STK_ENTER_PROGMODE
        const resp = await this.read(2);
        return resp.length >= 1 && resp[0] === 0x14;
    }

    async leaveProgMode() {
        await this.send([0x51, 0x20]); // STK_LEAVE_PROGMODE
        await this.read(2);
    }

    async loadAddress(byteAddr) {
        // STK_LOAD_ADDRESS takes word address (byte/2)
        const wordAddr = byteAddr >> 1;
        await this.send([0x55, wordAddr & 0xff, (wordAddr >> 8) & 0xff, 0x20]);
        await this.read(2);
    }

    async programPage(pageBytes) {
        // STK_PROG_PAGE: 0x64, lenHi, lenLo, memType('F'), data..., 0x20
        const len = pageBytes.length;
        const cmd = new Uint8Array(5 + len);
        cmd[0] = 0x64;
        cmd[1] = (len >> 8) & 0xff;
        cmd[2] = len & 0xff;
        cmd[3] = 0x46; // 'F' Flash
        cmd.set(pageBytes, 4);
        cmd[4 + len] = 0x20; // CRC_EOP

        const writer = this.port.writable.getWriter();
        await writer.write(cmd);
        writer.releaseLock();

        const resp = await this.read(2);
        return resp.length >= 1 && resp[0] === 0x14;
    }

    async flashHex(hexString, onProgress) {
        const binary = parseIntelHex(hexString);
        const pageSize = 128; // Uno (ATmega328P) default

        this.log(`Binary size: ${binary.length} bytes`);

        if (!(await this.sync())) throw new Error("Sync failed. Press reset and try again.");
        if (!(await this.enterProgMode())) throw new Error("Could not enter programming mode.");

        for (let addr = 0; addr < binary.length; addr += pageSize) {
            const page = binary.slice(addr, addr + pageSize);
            await this.loadAddress(addr);
            const ok = await this.programPage(page);
            if (!ok) throw new Error(`Write failed at address 0x${addr.toString(16)}`);
            if (onProgress) onProgress(Math.round((addr / binary.length) * 100));
        }

        await this.leaveProgMode();
    }
}

function parseIntelHex(hex) {
    // Basic Intel HEX parser; fills unused bytes with 0xFF
    const data = new Uint8Array(32768).fill(0xff); // 32KB max for Uno
    let maxAddr = 0;

    const lines = hex.split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        if (!line.startsWith(':') || line.length < 11) continue;

        const byteCount = parseInt(line.substr(1, 2), 16);
        const addr = parseInt(line.substr(3, 4), 16);
        const recType = parseInt(line.substr(7, 2), 16);

        if (recType === 0x00) { // data record
            for (let i = 0; i < byteCount; i++) {
                const byteVal = parseInt(line.substr(9 + i * 2, 2), 16);
                data[addr + i] = byteVal;
            }
            maxAddr = Math.max(maxAddr, addr + byteCount);
        }
    }
    return data.slice(0, maxAddr);
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));
