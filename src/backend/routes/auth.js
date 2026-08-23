const { connectToDatabase } = require('../../index');
const bcrypt = require('bcrypt');

const pendingUsers = new Map(); // Stockage temporaire en mémoire des inscriptions en cours

async function register(req, res) {
  try {
    const { username, email, password, confirmPassword } = req.body || {};

    if (!username || !email || !password || !confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Tous les champs sont requis (nom, mail, mdp, confirmation).' }));
      return;
    }

    if (password !== confirmPassword) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Les mots de passe ne correspondent pas.' }));
      return;
    }

    // Vérifier si l'utilisateur existe déjà en BDD
    const pool = await connectToDatabase();
    const [existing] = await pool.query(
      'SELECT id, username, email FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existing && existing.length > 0) {
      const isEmail = existing.some(u => u.email.toLowerCase() === email.toLowerCase());
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        success: false, 
        error: isEmail ? 'Cet email est déjà enregistré.' : 'Ce nom d\'utilisateur est déjà pris.' 
      }));
      return;
    }

    // Générer OTP à 6 chiffres
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Envoyer l'OTP via le microservice mail
    try {
	//const mailResponse = await fetch('http://127.0.0.1:4001/send', {
        const mailUrl = process.env.MAIL_SERVICE_URL || 'http://mail-service:4001/send';
        const mailResponse = await fetch(mailUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: email,
          subject: 'Validation de votre compte - My Music',
          text: `Bonjour ${username},\n\nVotre code de validation OTP pour My Music est : ${otp}\n\nIl expire dans 15 minutes.`,
          html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
                  <h2>Bienvenue sur My Music !</h2>
                  <p>Bonjour <strong>${username}</strong>,</p>
                  <p>Pour finaliser votre inscription, veuillez saisir le code de validation ci-dessous :</p>
                  <div style="background: #f1f1f1; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 5px; text-align: center; border-radius: 5px; margin: 20px 0;">
                    ${otp}
                  </div>
                  <p>Ce code est valide pendant 15 minutes.</p>
                </div>`
        })
      });

      const mailResult = await mailResponse.json();
      if (!mailResponse.ok || !mailResult.success) {
        throw new Error(mailResult.error || 'Erreur lors de l\'envoi de l\'email');
      }
    } catch (mailError) {
      console.error('Erreur du service mail :', mailError);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Impossible d\'envoyer le code de validation par email.' }));
      return;
    }

    // Stocker temporairement les informations
    pendingUsers.set(email.toLowerCase(), {
      username,
      email,
      password,
      otp,
      expiresAt: Date.now() + 15 * 60 * 1000 // Valide 15 minutes
    });

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Un code de validation (OTP) a été envoyé à votre adresse email.' }));

  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body || {};

    if (!email || !otp) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'L\'email et le code OTP sont requis.' }));
      return;
    }

    const pending = pendingUsers.get(email.toLowerCase());

    if (!pending) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Aucune inscription en cours pour cet email.' }));
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingUsers.delete(email.toLowerCase());
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Le code OTP a expiré. Veuillez recommencer.' }));
      return;
    }

    if (pending.otp !== otp.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Code OTP incorrect.' }));
      return;
    }

    // Crypter le mot de passe
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(pending.password, saltRounds);

    // Insérer en base de données
    const pool = await connectToDatabase();
    await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, statut, deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'actif', FALSE, NOW(), NOW())`,
      [pending.username, pending.email, passwordHash, pending.username]
    );

    // Supprimer des inscriptions en attente
    pendingUsers.delete(email.toLowerCase());

    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'Inscription validée et compte créé avec succès !' }));

  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'L\'email et le mot de passe sont requis.' }));
      return;
    }

    const pool = await connectToDatabase();
    const [rows] = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE email = ? AND deleted = FALSE AND statut = \'actif\'',
      [email]
    );

    if (!rows || rows.length === 0) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Email ou mot de passe incorrect.' }));
      return;
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Email ou mot de passe incorrect.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      message: 'Connexion réussie !',
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    }));

  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

module.exports = {
  register,
  verifyOtp,
  login
};
