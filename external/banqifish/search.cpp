#include "endgame.hpp"

namespace {
constexpr int Win = 12000, Infinity = 16000, Unknown = 20000;
constexpr int MaxFrames = 31, FrameSize = 48, MaxDepth = 16;
constexpr int baseValue[Roles] = {450, 305, 230, 175, 125, 320, 85};
int value[14];
int16_t frames[MaxFrames][FrameSize];
struct Line { int from, to, score, depth; };
Line output[96];
int visited, limit, qLimit;

// The history covers only the reversible suffix. Addition retains multiplicity.
// Quiet count is independent of suffix length in standalone analysis diagrams.
Key path[MaxFrames + MaxDepth + 12];
struct History {
    int first = 0, end = 0;
    Key signature = 0;
    bool duplicate = false;
    int occurrences(Key key) const {
        int count = 0;
        for (int i = first; i < end; ++i) count += path[i] == key;
        return count;
    }
    History append(Key key, int seen) const {
        path[end] = key;
        return {first, end + 1, signature + key, duplicate || seen != 0};
    }
    History reset() const { return {end, end, 0, false}; }
};

// Bounds are valid only for this position, draw history, remaining chance
// allowance and search ply (terminal values include distance from the root).
struct Entry { Key key; int16_t score; uint8_t depth, bound; Move best; };
Entry cache[4096];
enum Bound { Exact = 1, Lower, Upper };

bool readPosition(const int16_t *f, Position &p) {
    constexpr int stock[Roles] = {1, 2, 2, 2, 2, 2, 5};
    int counts[14]{};
    for (int sq = 0; sq < Squares; ++sq) {
        int code = f[sq];
        if (code < 0 || code > Cover) return false;
        p.cell[sq] = uint8_t(code);
        p.key ^= zob.piece[code][sq];
        if (code == Cover) p.covers |= bit(sq);
        if (code < Empty) {
            ++counts[code];
            p.pieces[army(code)] |= bit(sq);
            p.kinds[role(code)] |= bit(sq);
        }
    }
    int covered = 0;
    for (int code = 0; code < 14; ++code) {
        int n = f[32 + code];
        if (n < 0 || n + counts[code] > stock[role(code)]) return false;
        p.bag[code] = uint8_t(n);
        p.key ^= zob.stock[code][n];
        covered += n;
        p.alive[army(code)] += uint8_t(n + counts[code]);
    }
    int turn = f[46], quiet = f[47];
    if (turn < 0 || turn > Unassigned || quiet < 0 || quiet > 30 ||
        covered != __builtin_popcount(p.covers) || (turn == Unassigned) != (covered == 32))
        return false;
    p.turn = uint8_t(turn);
    p.quiet = uint8_t(quiet);
    p.key ^= zob.side[turn];
    return true;
}

void material(Position &p) {
    int alive[14];
    for (int i = 0; i < 14; ++i)
        alive[i] = p.bag[i] + __builtin_popcount(p.pieces[army(i)] & p.kinds[role(i)]);
    for (int i = 0; i < 14; ++i) {
        int enemies = (1 - army(i)) * Roles, hunters = 0, prey = 0;
        for (int r = 0; r < Roles; ++r) {
            int count = alive[enemies + r];
            if (r == Cannon || ordinary(r, role(i))) hunters += count;
            if (role(i) == Cannon || ordinary(role(i), r)) prey += count;
        }
        int v = baseValue[role(i)] + 190 / (1 + hunters);
        if (role(i) == Soldier && alive[enemies + General]) v += 34;
        if (!prey) v /= 2;
        value[i] = v;
        p.balance += (army(i) ? -v : v) * alive[i];
    }
}

int evaluate(const Position &p) {
    int score = p.balance;
    Mask empty = ~p.occupied();
    bool endingPhase = p.alive[0] + p.alive[1] <= 12;
    for (int side = 0; side < 2; ++side) {
        int activity = 0;
        Mask threatened = 0;
        for (Mask mine = p.pieces[side]; mine;) {
            int sq = pop(mine), code = p.cell[sq], r = role(code);
            Mask adj = board.adjacent[sq], targets = p.victims(r, side ^ 1);
            activity += (3 + value[code] / 60) * __builtin_popcount(adj & empty);
            activity += 3 * __builtin_popcount(adj & p.pieces[side]);
            if (p.covers) activity += value[code] / 14 + 3 * __builtin_popcount(adj);
            threatened |= (r == Cannon ? p.jumps(sq) : adj) & targets;
            // Give a winning army a gradient towards catchable prey on an open board.
            if (endingPhase && targets) {
                int nearest = 11;
                while (targets) {
                    int dist = distance(sq, pop(targets));
                    if (dist < nearest) nearest = dist;
                }
                activity += (10 - nearest) * (r == Cannon ? 3 : 9);
            }
        }
        int largest = 0;
        while (threatened) {
            int target = value[p.cell[pop(threatened)]];
            if (target > largest) largest = target;
            activity += target / 14;
        }
        activity += largest / (side == p.turn ? 4 : 12);
        score += side ? -activity : activity;
    }
    return p.turn == 1 ? -score : score;
}

int terminal(const Position &p, int ply, int seen) {
    if (p.turn != Unassigned) {
        if (!p.alive[p.turn]) return -Win + ply;
        if (!p.alive[p.turn ^ 1]) return Win - ply;
    }
    if (!p.mobile()) return -Win + ply;
    if (p.quiet >= 30 || seen >= 2) return 0;
    return Unknown;
}

int twoPiece(const Position &p, int ply, bool repeatedHistory) {
    if (p.covers || p.alive[0] != 1 || p.alive[1] != 1) return Unknown;
    int me = __builtin_ctz(p.pieces[p.turn]), them = __builtin_ctz(p.pieces[p.turn ^ 1]);
    int a = role(p.cell[me]), b = role(p.cell[them]);
    int rights = ordinary(a, b) + 2 * ordinary(b, a);
    int dtm = ending.dtm[rights][me][them];
    if (!dtm || absInt(dtm) + p.quiet > 30) return 0;
    // Optimal decisive play strictly decreases DTM. A twice-seen ancestor
    // could still draw on its next visit, so search the actual path there.
    if (repeatedHistory) return Unknown;
    return dtm > 0 ? Win - ply - dtm : -Win + ply - dtm;
}

int flipOrder(const Position &p, int sq) {
    Mask neighbors = board.adjacent[sq];
    int score = 2 * __builtin_popcount(neighbors);
    if (p.turn == Unassigned) return score;
    // Nearby exposed high pieces and enemy cannon lines can take the newly
    // revealed piece immediately. Friend cannon lines can answer a capture.
    for (Mask near = neighbors & (p.pieces[0] | p.pieces[1]); near;) {
        int code = p.cell[pop(near)];
        if (role(code) != Cannon) score -= value[code] / (army(code) == p.turn ? 48 : 28);
    }
    Mask cannons = p.jumps(sq) & p.kinds[Cannon];
    return score + 12 * __builtin_popcount(cannons & p.pieces[p.turn])
                 - 17 * __builtin_popcount(cannons & p.pieces[p.turn ^ 1]);
}

int priority(const Position &p, Move m, Move hint) {
    if (m == hint) return 30000;
    if (m.flip()) return 0;
    int victim = p.cell[m.to];
    if (victim != Empty) return 4000 + 6 * value[victim] - value[p.cell[m.from]];
    return 1 + __builtin_popcount(board.adjacent[m.to]);
}

template <typename T, typename Before>
void sort(T *items, int size, Before before) {
    for (int i = 1; i < size; ++i) {
        T item = items[i];
        int j = i;
        while (j && before(item, items[j - 1])) {
            items[j] = items[j - 1];
            --j;
        }
        items[j] = item;
    }
}

int search(const Position &, History, int, int, int, int, int);

int actionValue(const Position &p, Move m, History history, int depth, int alpha, int beta,
                int ply, int chance) {
    if (!m.flip()) {
        Position child = p;
        child.play(m, 0, value);
        return -search(child, child.quiet ? history : history.reset(), depth - 1, -beta, -alpha, ply + 1, chance);
    }
    // Search each distinct public identity exactly once and weight by inventory.
    // Full windows keep the expectation free of alpha-beta bound values.
    int sum = 0, total = __builtin_popcount(p.covers);
    for (int code = 0; code < 14; ++code) {
        if (!p.bag[code]) continue;
        Position child = p;
        child.play(m, code, value);
        sum -= p.bag[code] * search(child, history.reset(), depth - 1, -Infinity, Infinity, ply + 1, chance - 1);
        if (visited >= limit) break;
    }
    return sum / total;
}

int search(const Position &p, History h, int depth, int alpha, int beta, int ply, int chance) {
    ++visited;
    int seen = p.quiet >= 2 ? h.occurrences(p.key) : 0;
    int score = terminal(p, ply, seen);
    if (score != Unknown) return score;
    score = twoPiece(p, ply, h.duplicate || seen != 0);
    if (score != Unknown) return score;
    bool quiescing = depth <= 0;
    int best = -Infinity, originalAlpha = alpha;
    // When the selective reveal horizon is exhausted, a subsequent flip can
    // end this tactical line at its public static estimate. Exposed moves still compete.
    if (quiescing || (p.covers && chance == 0)) {
        best = evaluate(p);
        if (depth <= -qLimit || best >= beta) return best;
        if (best > alpha) alpha = best;
    }
    Key key = p.key ^ mix(h.signature + p.quiet + 37 * (ply + 32 * chance));
    Entry &entry = cache[key & 4095];
    Move hint{255, 255};
    if (!quiescing && entry.bound && entry.key == key) {
        hint = entry.best;
        if (entry.depth == depth &&
            (entry.bound == Exact || (entry.bound == Lower && entry.score >= beta) ||
             (entry.bound == Upper && entry.score <= alpha))) return entry.score;
    }
    Moves moves = p.moves(!quiescing, false);
    if (!quiescing && p.covers && chance > 0) {
        if (__builtin_popcount(p.covers) <= 3) {
            for (Mask down = p.covers; down;) { int sq = pop(down); moves.add(sq, sq); }
        } else {
            int bestSq = 0, order = -Infinity;
            for (Mask down = p.covers; down;) {
                int sq = pop(down), rank = flipOrder(p, sq);
                if (rank > order) { bestSq = sq; order = rank; }
            }
            moves.add(bestSq, bestSq);
        }
    }
    sort(moves.items, moves.size, [&](Move a, Move b) { return priority(p, a, hint) > priority(p, b, hint); });
    History next = h.append(p.key, seen);
    Move bestMove = hint;
    for (int i = 0; i < moves.size && visited < limit; ++i) {
        Move m = moves.items[i];
        int v = actionValue(p, m, next, depth, alpha, beta, ply, chance);
        if (v > best) { best = v; bestMove = m; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
    }
    if (!quiescing && visited < limit)
        entry = {key, int16_t(best), uint8_t(depth),
                 uint8_t(best <= originalAlpha ? Upper : best >= beta ? Lower : Exact), bestMove};
    return best;
}

struct Candidate { Move move; int score = 0, depth = 0; bool active = true, principal = true; };
int openingClass(int s) {
    int f = s % 4, r = s / 4;
    return (f < 2 ? f : 3 - f) + 2 * (r < 4 ? r : 7 - r);
}
}

extern "C" {
int16_t *input() { return &frames[0][0]; }
const Line *lines() { return output; }
int nodes() { return visited; }

int analyse(int count, int budget, int maxDepth, int qDepth, int multiPv) {
    if (count < 1 || count > MaxFrames || budget < 1 || budget > 1000000 ||
        maxDepth < 1 || maxDepth > MaxDepth || qDepth < 0 || qDepth > 8 || multiPv < 1 || multiPv > 5) return -1;
    History h;
    Position root;
    visited = 0;
    for (int i = 0; i < count; ++i) {
        Position p;
        if (!readPosition(frames[i], p)) return -1;
        if (i + 1 == count) root = p;
        else h = h.append(p.key, h.occurrences(p.key));
    }
    int seen = h.occurrences(root.key);
    if (terminal(root, 0, seen) != Unknown) return 0;
    h = h.append(root.key, seen);
    material(root);
    for (auto &e : cache) e.bound = 0;
    Moves moves = root.moves(true, true);
    Candidate choices[96];
    for (int i = 0; i < moves.size; ++i) choices[i].move = moves.items[i];
    // A static first pass costs at most 32 * 14 + 60 child visits. Every
    // legal action therefore has a score even at the smallest supported level.
    limit = budget;
    int chance = root.turn == Unassigned || __builtin_popcount(root.covers) <= 3 ? 2 : 1;
    for (int pass = 0; pass <= maxDepth && visited < limit; ++pass) {
        int depth = pass ? pass : 1;
        qLimit = !pass ? 0 : qDepth;
        if (pass == 1 && !qDepth) continue;
        int scores[96], mirrored[8], leaders[5];
        bool exact[96]{};
        for (int &v : leaders) v = -Infinity;
        for (int &v : mirrored) v = Unknown;
        for (int i = 0; i < moves.size; ++i) {
            if (!choices[i].active) continue;
            Move m = choices[i].move;
            int &mirror = mirrored[openingClass(m.to)];
            int threshold = leaders[multiPv - 1];
            if (root.turn == Unassigned && mirror != Unknown) scores[i] = mirror;
            else {
                // Root PVS leaves screened-out moves at their last exact score.
                // Only moves entering MultiPV need a second full-window search.
                if (depth >= 3 && !m.flip() && threshold > -Infinity) {
                    scores[i] = actionValue(root, m, h, depth, threshold, threshold + 1, 0, chance);
                    if (visited >= limit) break;
                    if (scores[i] <= threshold) continue;
                }
                scores[i] = actionValue(root, m, h, depth, -Infinity, Infinity, 0, chance);
                if (root.turn == Unassigned) mirror = scores[i];
            }
            if (visited >= limit) break;
            exact[i] = true;
            if (scores[i] > threshold) {
                int j = multiPv - 1;
                while (j && scores[i] > leaders[j - 1]) { leaders[j] = leaders[j - 1]; --j; }
                leaders[j] = scores[i];
            }
        }
        if (visited >= limit) break;
        for (int i = 0; i < moves.size; ++i) {
            choices[i].principal = exact[i] && scores[i] >= leaders[multiPv - 1];
            if (!exact[i]) continue;
            choices[i].score = scores[i];
            choices[i].depth = depth;
        }
        sort(choices, moves.size, [](Candidate a, Candidate b) {
            if (a.principal != b.principal) return a.principal;
            if (a.active != b.active) return a.active;
            return a.score > b.score;
        });
        if (pass == 1 && root.turn != Unassigned) {
            int flips = 0;
            for (int i = 0; i < moves.size; ++i)
                if (choices[i].move.flip() && ++flips > (multiPv > 4 ? multiPv : 4)) choices[i].active = false;
        }
        if (!root.covers && root.alive[0] == 1 && root.alive[1] == 1 && !h.duplicate) break;
        if (depth >= 2 && choices[0].score >= Win - depth) break;
    }
    for (int i = 0; i < moves.size; ++i) {
        auto c = choices[i];
        output[i] = {c.move.from, c.move.to, c.score, c.depth};
    }
    return moves.size;
}
}
