import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import lila.xiangqi.Jieqi;
import lila.xiangqi.Xiangqi.Position;
import lila.xiangqi.XiangqiRules;
import lila.xiangqi.adjudication.Ruleset;
import scala.jdk.javaapi.CollectionConverters;
import scala.util.Either;

/** Source-file bridge: validates records using the owning rules, never an engine approximation. */
class JieqiRules {
    private static <T> T checked(Either<String, T> value) {
        if (value.isLeft()) throw new IllegalArgumentException(value.swap().toOption().get());
        return value.toOption().get();
    }

    public static void main(String[] args) throws Exception {
        var json = new ObjectMapper();
        var input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String line;
        while ((line = input.readLine()) != null) {
            var response = new LinkedHashMap<String, Object>();
            try {
                var request = json.readTree(line);
                var game = checked(XiangqiRules.game(new Position(request.get("initialFen").asText(),
                    CollectionConverters.asScala(List.<String>of()).toVector(), Ruleset.valueOf("Jieqi"),
                    CollectionConverters.asScala(List.<scala.Option<String>>of()).toVector(),
                    scala.collection.immutable.Map$.MODULE$.<String, String>empty())));
                for (var item : request.get("moves")) {
                    var parts = item.asText().split("~", -1);
                    var uci = parts[0];
                    var reveal = scala.Option.apply(parts.length > 1 && !parts[1].isEmpty() ? parts[1] : null);
                    var capture = scala.Option.apply(parts.length > 2 ? parts[2] : null);
                    game = checked(game.applyMove(checked(Jieqi.analysisMove(game, uci, reveal, capture))));
                }
                var state = game.state();
                response.put("fen", state.fen());
                response.put("turn", state.turn().key());
                response.put("legalMoves", CollectionConverters.asJava(state.legalMoves()));
                response.put("gameResult", state.gameResult().key());
            } catch (IllegalArgumentException | java.util.NoSuchElementException error) {
                response.put("error", error.toString());
            }
            System.out.println(json.writeValueAsString(response));
            System.out.flush();
        }
    }
}
