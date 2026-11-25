#pragma once
#include "position.hpp"

// With two open pieces a cannon has no screen. The entire game reduces to the
// squares and two booleans: which of the two pieces can capture the other?
// Positive distances are wins for the mover, negative distances are losses.
// Unmarked states cannot force a capture inside the 30-ply clock.
struct TwoPieceTable {
    int8_t dtm[4][Squares][Squares]{};
    constexpr TwoPieceTable() {
        for (int ply = 1; ply <= 30; ++ply) {
            bool changed = false;
            for (int rights = 0; rights < 4; ++rights)
                for (int me = 0; me < Squares; ++me)
                    for (int them = 0; them < Squares; ++them) {
                        if (me == them || dtm[rights][me][them]) continue;
                        bool win = (rights & 1) && distance(me, them) == 1;
                        bool loss = true;
                        for (Mask nb = board.adjacent[me] & ~bit(them); nb; nb &= nb - 1) {
                            int to = __builtin_ctz(nb);
                            int child = dtm[(rights >> 1) | ((rights & 1) << 1)][them][to];
                            win |= child < 0 && -child < ply;
                            loss &= child > 0 && child < ply;
                        }
                        if (win || loss) {
                            dtm[rights][me][them] = int8_t(win ? ply : -ply);
                            changed = true;
                        }
                    }
            if (!changed) break;
        }
    }
};
inline constexpr TwoPieceTable ending{};
