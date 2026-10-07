import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import lila.xiangqi.Xiangqi.Game;
import lila.xiangqi.Xiangqi.Position;
import lila.xiangqi.XiangqiRules;
import lila.xiangqi.adjudication.Ruleset;
import scala.jdk.javaapi.CollectionConverters;
import scala.util.Either;

/** Offline JSON-lines bridge to the existing native rules, without a web app or database. */
class NativeRules {
    private static <T> T checked(Either<String, T> value) {
        if (value.isLeft()) throw new IllegalArgumentException(value.swap().toOption().get());
        return value.toOption().get();
    }

    public static void main(String[] args) throws Exception {
        var json = new ObjectMapper();
        var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        Game game = null;
        List<String> history = List.of();
        String initial = "";
        String line;
        while ((line = input.readLine()) != null) {
            var response = new LinkedHashMap<String, Object>();
            try {
                var request = json.readTree(line);
                var fen = request.get("initialFen").asText();
                var moves = new ArrayList<String>();
                for (var move : request.get("moves")) moves.add(move.asText());
                // Reuse immutable native history for successive plies. Rebuild
                // only at a new root or when replaying a different game branch.
                if (game == null || !fen.equals(initial) || moves.size() < history.size()
                        || !moves.subList(0, history.size()).equals(history)) {
                    game = checked(XiangqiRules.game(new Position(fen,
                        CollectionConverters.asScala(List.<String>of()).toVector(),
                        Ruleset.valueOf("Tiantian"))));
                    history = List.of();
                    initial = fen;
                }
                for (int index = history.size(); index < moves.size(); index++) {
                    game = checked(game.applyMove(checked(XiangqiRules.move(game, moves.get(index)))));
                }
                history = moves;
                var state = game.state();
                response.put("fen", state.fen());
                response.put("turn", state.turn().key());
                response.put("legalMoves", CollectionConverters.asJava(state.legalMoves()));
                response.put("gameResult", state.gameResult().key());
                response.put("termination", state.termination().isDefined() ? state.termination().get() : null);
            } catch (Exception error) {
                game = null;
                response.put("error", error.toString());
            }
            System.out.println(json.writeValueAsString(response));
            System.out.flush();
        }
    }
}
