import type { TeamRole } from "@/lib/teamAnalysis";

export interface ISharedTeamSlot {
    slotId?: number;
    friendId: number | null;
    personalityId: number | null;
    legacyTypeId: number | null;
    moveIds: number[];
    roles: TeamRole[];
}

export interface ISharedTeamState {
    name: string;
    magicItemId: number | null;
    slots: ISharedTeamSlot[];
}

export function serializeTeamShareState(state: ISharedTeamState) {
    return {
        name: state.name,
        magicItemId: state.magicItemId,
        slots: state.slots.map((slot) => ({
            friendId: slot.friendId,
            legacyTypeId: slot.legacyTypeId,
            moveIds: slot.moveIds,
            personalityId: slot.personalityId,
            roles: slot.roles,
        })),
    };
}

function utf8ToBinary(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return binary;
}

function binaryToUtf8Bytes(binary: string) {
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// 分享链接把队伍编码后手工拼进 ?team=，绕开了 router 的查询值编码。
// 标准 base64 的 '+' 在 URL 查询里是空格的转义，vue-router 的 parseQuery 会把它
// 还原成空格，载荷就此损坏（队伍名含中文时几乎必然出现 '+'）。改用 base64url：
// '+/' 换成 '-_' 并去掉 '=' 填充，全字符集在查询串里都是安全的。
export function encodeTeamSharePayload(state: ISharedTeamState) {
    const json = JSON.stringify(serializeTeamShareState(state));
    const bytes = new TextEncoder().encode(json);
    return btoa(utf8ToBinary(bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

export function decodeTeamSharePayload(payload: string) {
    try {
        // 兼容三种来源：新的 base64url、历史的标准 base64，以及历史链接被
        // parseQuery 打成空格的 '+'。只把空格还原成 '+'，换行/Tab 先剥掉：
        // Node 的 atob 在补了 '=' 之后会把换行当非法字符，不能留给它忽略。
        const normalized = payload
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .replace(/ /g, "+")
            .replace(/[\n\r\t]/g, "");
        const pad = normalized.length % 4;
        const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
        const binary = atob(padded);
        const json = new TextDecoder().decode(binaryToUtf8Bytes(binary));
        return JSON.parse(json);
    } catch {
        return null;
    }
}
