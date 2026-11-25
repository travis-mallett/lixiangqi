// BanqiFish. Squares are a1, b1, c1, d1, a2, ... d8 in the public diagram.
#pragma once
#include <stdint.h>

using Mask = uint32_t;
using Key = uint64_t;
constexpr int Squares = 32, Roles = 7, Empty = 14, Cover = 15, Unassigned = 2;
enum Role { General, Advisor, Elephant, Chariot, Horse, Cannon, Soldier };
constexpr int army(int piece) { return piece / Roles; }
constexpr int role(int piece) { return piece % Roles; }
constexpr Mask bit(int square) { return Mask{1} << square; }
inline int pop(Mask &mask) {
    int square = __builtin_ctz(mask);
    mask &= mask - 1;
    return square;
}
constexpr int absInt(int n) { return n < 0 ? -n : n; }
constexpr int distance(int a, int b) {
    return absInt(a % 4 - b % 4) + absInt(a / 4 - b / 4);
}
constexpr bool ordinary(int a, int v) {
    if (a == Cannon) return false;
    if (a == Soldier) return v == Soldier || v == General;
    return a <= v && !(a == General && v == Soldier);
}

struct Geometry {
    Mask adjacent[Squares]{}, ray[Squares][4]{};
    constexpr Geometry() {
        for (int s = 0; s < Squares; ++s) {
            for (int t = 0; t < Squares; ++t) {
                if (s == t) continue;
                if (distance(s, t) == 1) adjacent[s] |= bit(t);
                if (s / 4 == t / 4) ray[s][t < s ? 0 : 1] |= bit(t);
                if (s % 4 == t % 4) ray[s][t < s ? 2 : 3] |= bit(t);
            }
        }
    }
};
inline constexpr Geometry board{};

constexpr Key mix(Key x) {
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}
struct HashKeys {
    Key piece[16][Squares]{}, stock[14][6]{}, side[3]{};
    constexpr HashKeys() {
        for (int p = 0; p < 16; ++p)
            for (int s = 0; s < Squares; ++s)
                if (p != Empty) piece[p][s] = mix(1 + p * Squares + s);
        for (int p = 0; p < 14; ++p)
            for (int n = 1; n <= 5; ++n) stock[p][n] = mix(600 + 6 * p + n);
        for (int c = 0; c < 3; ++c) side[c] = mix(800 + c);
    }
};
inline constexpr HashKeys zob{};

struct Move {
    uint8_t from, to;
    bool flip() const { return from == to; }
    bool operator==(Move m) const { return from == m.from && to == m.to; }
};

// At most one step per edge endpoint, one jump per cannon ray, and one flip per cover.
// The 4x8 board has 52 edges, at most two moving cannons and 32 covers.
struct Moves {
    Move items[96];
    int size = 0;
    void add(int f, int t) { items[size++] = {uint8_t(f), uint8_t(t)}; }
};

struct Position {
    uint8_t cell[Squares]{}, bag[14]{}, alive[2]{};
    uint8_t turn = Unassigned, quiet = 0;
    Mask pieces[2]{}, kinds[Roles]{}, covers = 0;
    Key key = 0;
    int balance = 0; // Public material, including pieces still in the bag. Positive for Red.

    Mask occupied() const { return pieces[0] | pieces[1] | covers; }

    // The second occupied square on a ray is the only possible cannon target.
    Mask jumps(int square) const {
        Mask targets = 0;
        for (int d = 0; d < 4; ++d) {
            Mask ray = board.ray[square][d] & occupied();
            if (!ray) continue;
            if (d & 1) {
                ray &= ray - 1;
                targets |= ray & -ray;
            } else {
                ray ^= bit(31 - __builtin_clz(ray));
                if (ray) targets |= bit(31 - __builtin_clz(ray));
            }
        }
        return targets;
    }
    Mask victims(int r, int enemy) const {
        Mask targets = pieces[enemy];
        switch (r) {
        case General: return targets & ~kinds[Soldier];
        case Advisor: return targets & ~kinds[General];
        case Elephant: return targets & ~(kinds[General] | kinds[Advisor]);
        case Chariot: return targets & (kinds[Chariot] | kinds[Horse] | kinds[Cannon] | kinds[Soldier]);
        case Horse: return targets & (kinds[Horse] | kinds[Cannon] | kinds[Soldier]);
        case Soldier: return targets & (kinds[Soldier] | kinds[General]);
        default: return targets;
        }
    }
    Mask captures(int square, int r, int enemy) const {
        return r == Cannon ? jumps(square) & pieces[enemy] : board.adjacent[square] & victims(r, enemy);
    }
    Moves moves(bool quietMoves, bool flips) const {
        Moves out;
        Mask mine = turn == Unassigned ? 0 : pieces[turn];
        while (mine) {
            int from = pop(mine);
            Mask dest = captures(from, role(cell[from]), turn ^ 1);
            if (quietMoves) dest |= board.adjacent[from] & ~occupied();
            while (dest) out.add(from, pop(dest));
        }
        if (flips)
            for (Mask down = covers; down;) { int sq = pop(down); out.add(sq, sq); }
        return out;
    }
    bool mobile() const {
        if (covers) return true;
        for (Mask mine = pieces[turn]; mine;) {
            int from = pop(mine);
            if ((board.adjacent[from] & ~occupied()) || captures(from, role(cell[from]), turn ^ 1))
                return true;
        }
        return false;
    }
    void play(Move m, int reveal, const int *value) {
        int next = turn ^ 1;
        if (m.flip()) {
            covers ^= bit(m.to);
            key ^= zob.piece[Cover][m.to] ^ zob.stock[reveal][bag[reveal]];
            --bag[reveal];
            key ^= zob.stock[reveal][bag[reveal]];
            if (turn == Unassigned) next = army(reveal) ^ 1;
            cell[m.to] = uint8_t(reveal);
            quiet = 0;
        } else {
            int attacker = cell[m.from], target = cell[m.to];
            cell[m.from] = Empty;
            pieces[turn] ^= bit(m.from);
            kinds[role(attacker)] ^= bit(m.from);
            key ^= zob.piece[attacker][m.from];
            if (target != Empty) {
                pieces[next] ^= bit(m.to);
                kinds[role(target)] ^= bit(m.to);
                key ^= zob.piece[target][m.to];
                --alive[next];
                balance += next == 0 ? -value[target] : value[target];
                quiet = 0;
            } else ++quiet;
            cell[m.to] = uint8_t(attacker);
        }
        int p = cell[m.to];
        pieces[army(p)] |= bit(m.to);
        kinds[role(p)] |= bit(m.to);
        key ^= zob.piece[p][m.to] ^ zob.side[turn] ^ zob.side[next];
        turn = uint8_t(next);
    }
};
