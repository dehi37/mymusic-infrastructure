# 1. Utiliser une image officielle Node.js légère
FROM node:20-alpine

# 2. Définir le répertoire de travail dans le conteneur
WORKDIR /app

# 3. Copier les fichiers de gestion des dépendances
COPY package*.json ./

# 4. Installer uniquement les dépendances de production
RUN npm ci --only=production

# 5. Copier le reste du code source
COPY . .

# 6. Exposer le port sur lequel votre serveur écoute
EXPOSE 3000

# 7. Commande pour démarrer l'application
CMD ["npm", "start"]
