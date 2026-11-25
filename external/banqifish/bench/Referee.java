import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.HashMap;
import lila.xiangqi.Banqi;
import lila.xiangqi.Xiangqi.Game;
import scala.jdk.javaapi.CollectionConverters;
import scala.util.Either;

/** One offline instance of the production referee can serve multiple independent games. */
class Referee {
    static <T> T checked(Either<String, T> value) {
        if (value.isLeft()) throw new IllegalArgumentException(value.swap().toOption().get());
        return value.toOption().get();
    }

    public static void main(String[] args) throws Exception {
        var input = new BufferedReader(new InputStreamReader(System.in));
        var games = new HashMap<String, Game>();
        for (String line; (line = input.readLine()) != null;) {
            var fields = line.split("\t");
            String id = fields[0];
            Game game;
            if (fields[1].equals("deal")) {
                var deal = checked(lila.xiangqi.Banqi.Deal$.MODULE$.read(fields[2]));
                game = checked(Banqi.initial(deal));
            } else {
                var previous = games.get(id);
                game = checked(previous.applyMove(checked(Banqi.play(previous, fields[1]))));
            }
            var state = game.state();
            if (state.ended()) games.remove(id);
            else games.put(id, game);
            var legal = String.join(" ", CollectionConverters.asJava(state.legalMoves()));
            System.out.println(state.fen() + "\t" + state.gameResult().key() + "\t" +
                    state.termination().getOrElse(() -> "-") + "\t" + legal);
        }
    }
}
