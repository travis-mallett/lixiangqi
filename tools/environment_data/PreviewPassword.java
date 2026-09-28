// Run with the compiled security module and conf on the classpath.
// Reuse the application hasher; never maintain a second password format.
import com.typesafe.config.ConfigFactory;
import java.util.Base64;
import lila.security.PasswordHasher;
import scala.concurrent.ExecutionContext;

class PreviewPassword {
    public static void main(String[] args) throws Exception {
        String secret = ConfigFactory.load().getString("user.password.bpass.secret");
        PasswordHasher hasher = new PasswordHasher(secret, 10,
            PasswordHasher.$lessinit$greater$default$3(), ExecutionContext.global(), false);
        String password = new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        var hash = hasher.hash(password);
        if (!hasher.check(hash, password)) throw new IllegalStateException("Password verification failed");
        System.out.println(Base64.getEncoder().encodeToString(hash.bytes()));
    }
}
