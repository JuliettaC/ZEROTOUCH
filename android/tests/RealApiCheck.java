package cl.zerotouch.mobile;

/**
 * Comprobación manual (no forma parte de test-core.ps1): el cliente Java del teléfono contra un backend
 * real con base temporal. La lanza scripts/probar-contrato-movil.sh con la cuenta ficticia que crea.
 */
public final class RealApiCheck {
    public static void main(String[] args) throws Exception {
        String url = args[0], user = args[1], password = args[2];
        ApiClient api = new ApiClient(url);
        ModeLoader.Result first = ModeLoader.load(api, user, password);
        System.out.println("login + lectura: ok=" + first.ok + " | " + first.message);
        if (first.ok) System.out.println(first.actions.describe());
        ModeLoader.Result again = ModeLoader.load(api, user, "");
        System.out.println("actualizar con la cookie (sin contraseña): ok=" + again.ok);
        ModeLoader.Result wrong = ModeLoader.load(new ApiClient(url), user, "clave-incorrecta-1");
        System.out.println("contraseña incorrecta: ok=" + wrong.ok + " | " + wrong.message);
        if (!first.ok || !again.ok || wrong.ok) System.exit(1);
    }
}
