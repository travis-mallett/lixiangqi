import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import lila.xiangqi.Jieqi;
import lila.xiangqi.Xiangqi.Game;
import lila.xiangqi.XiangqiRules;
import scala.jdk.javaapi.CollectionConverters;
import scala.util.Either;

/** Offline referee: the actual LiXiangQi rules own legality, reveals and results. */
class JieqiReferee {
    private static <T> T checked(Either<String, T> value) {
        if (value.isLeft()) throw new IllegalArgumentException(value.swap().toOption().get());
        return value.toOption().get();
    }

    public static void main(String[] args) throws Exception {
        var json = new ObjectMapper();
        var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        Game game = null;
        String line;
        while ((line = input.readLine()) != null) {
            var response = new LinkedHashMap<String, Object>();
            try {
                var request = json.readTree(line);
                if (request.has("deal")) {
                    var identities = new LinkedHashMap<String, String>();
                    request.get("deal").fields().forEachRemaining(e -> identities.put(e.getKey(), e.getValue().asText()));
                    var map = scala.collection.immutable.Map$.MODULE$.<String, String>from(
                        CollectionConverters.asScala(identities));
                    game = checked(Jieqi.initial(new Jieqi.Deal(map)));
                } else if (request.has("move") && game != null) {
                    game = checked(game.applyMove(checked(XiangqiRules.move(game, request.get("move").asText()))));
                } else throw new IllegalArgumentException("Expected a deal or a move");
                var state = game.state();
                var observation = Jieqi.observation(game);
                response.put("fen", state.fen());
                response.put("turn", state.turn().key());
                response.put("legalMoves", CollectionConverters.asJava(state.legalMoves()));
                response.put("remaining", CollectionConverters.asJava(observation.remaining()));
                response.put("result", state.gameResult().key());
                response.put("termination", state.termination().isDefined() ? state.termination().get() : null);
                response.put("reveal", state.reveal().isDefined() ? state.reveal().get() : null);
                response.put("ply", state.ply());
            } catch (Exception error) {
                game = null;
                response.put("error", error.toString());
            }
            System.out.println(json.writeValueAsString(response));
            System.out.flush();
        }
    }
}
