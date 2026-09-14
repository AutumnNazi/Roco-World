// nrc BWIKI 的数据模块是构建器生成的规整 Lua 表：只有字面量、嵌套表与三类键
// （标识符键 / ["字符串"] 键 / [数字] 键），没有函数调用与表达式，因此可以用
// 一个小型递归下降解析器安全读取，不需要引入 Lua 运行时。
export function parseLuaTable(source) {
    const text = stripComments(source);
    const returnIndex = text.indexOf("return");

    if (returnIndex === -1) {
        throw new Error("Lua 模块缺少 return 语句。");
    }

    const parser = { text, pos: returnIndex + "return".length };
    skipWhitespace(parser);
    const value = parseValue(parser);
    return value;
}

function stripComments(source) {
    // 数据模块的注释只有整行 `--` 形式，逐行剥离即可，避免误伤字符串里的 "--"。
    return source
        .split(/\r?\n/)
        .map((line) => (line.trimStart().startsWith("--") ? "" : line))
        .join("\n");
}

function parseValue(parser) {
    skipWhitespace(parser);
    const char = parser.text[parser.pos];

    if (char === "{") {
        return parseTable(parser);
    }

    if (char === '"' || char === "'") {
        return parseString(parser);
    }

    if (parser.text.startsWith("true", parser.pos)) {
        parser.pos += 4;
        return true;
    }

    if (parser.text.startsWith("false", parser.pos)) {
        parser.pos += 5;
        return false;
    }

    if (parser.text.startsWith("nil", parser.pos)) {
        parser.pos += 3;
        return null;
    }

    return parseNumber(parser);
}

function parseTable(parser) {
    expect(parser, "{");

    const map = new Map();
    const arrayItems = [];
    let hasExplicitKey = false;

    for (;;) {
        skipWhitespace(parser);

        if (parser.text[parser.pos] === "}") {
            parser.pos += 1;
            break;
        }

        if (parser.pos >= parser.text.length) {
            throw new Error("Lua 表未正常闭合。");
        }

        const key = tryParseKey(parser);

        if (key === null) {
            arrayItems.push(parseValue(parser));
        } else {
            hasExplicitKey = true;
            map.set(key, parseValue(parser));
        }

        skipSeparators(parser);
    }

    if (!hasExplicitKey) {
        return arrayItems;
    }

    const result = {};

    for (const [key, value] of map) {
        result[key] = value;
    }

    // 少数表同时含数组段与键值段（例如 stats 里混排），数组段用 1..n 还原。
    arrayItems.forEach((item, index) => {
        const positionalKey = String(index + 1);

        if (!(positionalKey in result)) {
            result[positionalKey] = item;
        }
    });

    return result;
}

// 返回键名字符串；若当前位置不是键（即数组元素），返回 null 并保持位置不变。
function tryParseKey(parser) {
    const start = parser.pos;
    const char = parser.text[parser.pos];

    if (char === "[") {
        parser.pos += 1;
        skipWhitespace(parser);
        const bracketChar = parser.text[parser.pos];
        let key;

        if (bracketChar === '"' || bracketChar === "'") {
            key = parseString(parser);
        } else {
            key = String(parseNumber(parser));
        }

        skipWhitespace(parser);
        expect(parser, "]");
        skipWhitespace(parser);

        if (parser.text[parser.pos] !== "=") {
            parser.pos = start;
            return null;
        }

        parser.pos += 1;
        return key;
    }

    if (!isIdentifierStart(char)) {
        return null;
    }

    const identifier = readIdentifier(parser);
    skipWhitespace(parser);

    // true / false / nil 是数组元素而不是键，靠后面有没有 "=" 区分。
    if (parser.text[parser.pos] !== "=" || parser.text[parser.pos + 1] === "=") {
        parser.pos = start;
        return null;
    }

    parser.pos += 1;
    return identifier;
}

function parseString(parser) {
    const quote = parser.text[parser.pos];
    parser.pos += 1;

    let result = "";

    while (parser.pos < parser.text.length) {
        const char = parser.text[parser.pos];

        if (char === "\\") {
            const next = parser.text[parser.pos + 1];
            result += decodeEscape(next);
            parser.pos += 2;
            continue;
        }

        if (char === quote) {
            parser.pos += 1;
            return result;
        }

        result += char;
        parser.pos += 1;
    }

    throw new Error("Lua 字符串未正常闭合。");
}

function decodeEscape(char) {
    switch (char) {
        case "n":
            return "\n";
        case "t":
            return "\t";
        case "r":
            return "\r";
        default:
            return char;
    }
}

function parseNumber(parser) {
    const match = /^-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(
        parser.text.slice(parser.pos),
    );

    if (!match) {
        const preview = parser.text.slice(parser.pos, parser.pos + 16);
        throw new Error(`Lua 数字解析失败（"${preview}"）。`);
    }

    parser.pos += match[0].length;
    return Number(match[0]);
}

function skipWhitespace(parser) {
    while (parser.pos < parser.text.length && /\s/.test(parser.text[parser.pos])) {
        parser.pos += 1;
    }
}

function skipSeparators(parser) {
    for (;;) {
        skipWhitespace(parser);
        const char = parser.text[parser.pos];

        if (char === "," || char === ";") {
            parser.pos += 1;
            continue;
        }

        return;
    }
}

function expect(parser, char) {
    skipWhitespace(parser);

    if (parser.text[parser.pos] !== char) {
        const preview = parser.text.slice(parser.pos, parser.pos + 16);
        throw new Error(`Lua 解析期望 "${char}"，实际为 "${preview}"。`);
    }

    parser.pos += 1;
}

function isIdentifierStart(char) {
    return typeof char === "string" && /[A-Za-z_]/.test(char);
}

function readIdentifier(parser) {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(parser.text.slice(parser.pos));

    if (!match) {
        throw new Error("Lua 标识符解析失败。");
    }

    parser.pos += match[0].length;
    return match[0];
}
