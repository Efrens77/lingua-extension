import * as storage from "./storage.js";

export const INTERFACE_LANGUAGES = [
  ["auto", "Auto (browser language)"], ["en", "English"], ["es", "Spanish"], ["fr", "French"],
  ["de", "German"], ["pt", "Portuguese"], ["zh", "Chinese"], ["ja", "Japanese"], ["ko", "Korean"],
];

const STRINGS = {
  en: { settings:"Settings", close:"Close settings", interfaceLanguage:"Interface language", textSize:"Text size", smaller:"Smaller", larger:"Larger", darkMode:"Dark mode", lightMode:"Light mode", feedback:"Send feedback", auto:"Auto (browser language)", translateMode:"Translate mode", fullPage:"Full page", phrase:"Phrase", pageHint:"Lingua detects the page language and translates readable text in place.", phraseHint:"Highlight text on the page or type it below.", from:"Translate from", to:"Translate to", original:"Original text", translated:"Translated text", originalText:"Original text", result:"The translation will appear here.", refresh:"Re-read this page", clear:"Clear text", copy:"Copy translation", listen:"Listen to translation", detected:"Detected:", recent:"Recent translations", downloading:"Downloading language model…", translating:"Translating…", unavailable:"Translation is temporarily unavailable. Please try again shortly.", limit:"Translation service limit reached. Please wait a moment and try again.", regularPage:"Open a regular website to translate this page." },
  es: { settings:"Configuración", close:"Cerrar configuración", interfaceLanguage:"Idioma de la interfaz", textSize:"Tamaño del texto", smaller:"Más pequeño", larger:"Más grande", darkMode:"Modo oscuro", lightMode:"Modo claro", feedback:"Enviar comentarios", auto:"Automático (idioma del navegador)", translateMode:"Modo de traducción", fullPage:"Página completa", phrase:"Frase", pageHint:"Lingua detecta el idioma y traduce el texto legible en la página.", phraseHint:"Resalta texto en la página o escríbelo abajo.", from:"Traducir desde", to:"Traducir a", original:"Texto original", translated:"Texto traducido", originalText:"Texto original", result:"La traducción aparecerá aquí.", refresh:"Volver a leer esta página", clear:"Borrar texto", copy:"Copiar traducción", listen:"Escuchar traducción", detected:"Detectado:", recent:"Traducciones recientes", downloading:"Descargando modelo de idioma…", translating:"Traduciendo…", unavailable:"La traducción no está disponible temporalmente. Inténtalo de nuevo pronto.", limit:"Se alcanzó el límite del servicio de traducción. Espera un momento e inténtalo de nuevo.", regularPage:"Abre un sitio web normal para traducir esta página." },
  fr: { settings:"Paramètres", close:"Fermer les paramètres", interfaceLanguage:"Langue de l’interface", textSize:"Taille du texte", smaller:"Plus petit", larger:"Plus grand", darkMode:"Mode sombre", lightMode:"Mode clair", feedback:"Envoyer un commentaire", auto:"Automatique (langue du navigateur)", translateMode:"Mode de traduction", fullPage:"Page entière", phrase:"Phrase", pageHint:"Lingua détecte la langue et traduit le texte lisible sur la page.", phraseHint:"Sélectionnez du texte sur la page ou saisissez-le ci-dessous.", from:"Traduire depuis", to:"Traduire vers", original:"Texte original", translated:"Texte traduit", originalText:"Texte original", result:"La traduction apparaîtra ici.", refresh:"Relire cette page", clear:"Effacer le texte", copy:"Copier la traduction", listen:"Écouter la traduction", detected:"Détecté :", recent:"Traductions récentes", downloading:"Téléchargement du modèle linguistique…", translating:"Traduction…", unavailable:"La traduction est temporairement indisponible. Réessayez bientôt.", limit:"La limite du service de traduction est atteinte. Patientez un instant et réessayez.", regularPage:"Ouvrez un site web normal pour traduire cette page." },
  de: { settings:"Einstellungen", close:"Einstellungen schließen", interfaceLanguage:"Sprache der Oberfläche", textSize:"Textgröße", smaller:"Kleiner", larger:"Größer", darkMode:"Dunkelmodus", lightMode:"Hellmodus", feedback:"Feedback senden", auto:"Automatisch (Browsersprache)", translateMode:"Übersetzungsmodus", fullPage:"Ganze Seite", phrase:"Textstelle", pageHint:"Lingua erkennt die Seitensprache und übersetzt lesbaren Text direkt.", phraseHint:"Markieren Sie Text auf der Seite oder geben Sie ihn unten ein.", from:"Übersetzen von", to:"Übersetzen nach", original:"Originaltext", translated:"Übersetzter Text", originalText:"Originaltext", result:"Die Übersetzung erscheint hier.", refresh:"Seite erneut lesen", clear:"Text löschen", copy:"Übersetzung kopieren", listen:"Übersetzung anhören", detected:"Erkannt:", recent:"Letzte Übersetzungen", downloading:"Sprachmodell wird heruntergeladen…", translating:"Übersetzen…", unavailable:"Die Übersetzung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.", limit:"Das Übersetzungslimit wurde erreicht. Warten Sie einen Moment und versuchen Sie es erneut.", regularPage:"Öffnen Sie eine normale Website, um diese Seite zu übersetzen." },
  pt: { settings:"Configurações", close:"Fechar configurações", interfaceLanguage:"Idioma da interface", textSize:"Tamanho do texto", smaller:"Menor", larger:"Maior", darkMode:"Modo escuro", lightMode:"Modo claro", feedback:"Enviar feedback", auto:"Automático (idioma do navegador)", translateMode:"Modo de tradução", fullPage:"Página inteira", phrase:"Frase", pageHint:"O Lingua detecta o idioma e traduz o texto legível na página.", phraseHint:"Selecione texto na página ou digite-o abaixo.", from:"Traduzir de", to:"Traduzir para", original:"Texto original", translated:"Texto traduzido", originalText:"Texto original", result:"A tradução aparecerá aqui.", refresh:"Ler esta página novamente", clear:"Limpar texto", copy:"Copiar tradução", listen:"Ouvir tradução", detected:"Detectado:", recent:"Traduções recentes", downloading:"Baixando modelo de idioma…", translating:"Traduzindo…", unavailable:"A tradução está temporariamente indisponível. Tente novamente em breve.", limit:"O limite do serviço de tradução foi atingido. Aguarde um momento e tente novamente.", regularPage:"Abra um site normal para traduzir esta página." },
  zh: { settings:"设置", close:"关闭设置", interfaceLanguage:"界面语言", textSize:"文字大小", smaller:"更小", larger:"更大", darkMode:"深色模式", lightMode:"浅色模式", feedback:"发送反馈", auto:"自动（浏览器语言）", translateMode:"翻译模式", fullPage:"整页", phrase:"短语", pageHint:"Lingua 会检测页面语言并直接翻译可读文本。", phraseHint:"在页面上选择文本或在下方输入。", from:"翻译自", to:"翻译为", original:"原文", translated:"译文", originalText:"原文", result:"翻译将显示在这里。", refresh:"重新读取此页面", clear:"清除文本", copy:"复制翻译", listen:"朗读翻译", detected:"检测到：", recent:"最近翻译", downloading:"正在下载语言模型…", translating:"正在翻译…", unavailable:"翻译暂时不可用，请稍后再试。", limit:"翻译服务已达限制，请稍候再试。", regularPage:"请打开普通网站以翻译此页面。" },
  ja: { settings:"設定", close:"設定を閉じる", interfaceLanguage:"表示言語", textSize:"文字サイズ", smaller:"小さく", larger:"大きく", darkMode:"ダークモード", lightMode:"ライトモード", feedback:"フィードバックを送信", auto:"自動（ブラウザの言語）", translateMode:"翻訳モード", fullPage:"ページ全体", phrase:"フレーズ", pageHint:"Lingua はページ言語を検出し、読み取り可能なテキストをその場で翻訳します。", phraseHint:"ページ上のテキストを選択するか、下に入力してください。", from:"翻訳元", to:"翻訳先", original:"原文", translated:"翻訳文", originalText:"原文", result:"翻訳がここに表示されます。", refresh:"このページを再読み込み", clear:"テキストを消去", copy:"翻訳をコピー", listen:"翻訳を聞く", detected:"検出：", recent:"最近の翻訳", downloading:"言語モデルをダウンロード中…", translating:"翻訳中…", unavailable:"翻訳は一時的に利用できません。しばらくしてからもう一度お試しください。", limit:"翻訳サービスの上限に達しました。少し待ってからもう一度お試しください。", regularPage:"このページを翻訳するには通常のウェブサイトを開いてください。" },
  ko: { settings:"설정", close:"설정 닫기", interfaceLanguage:"인터페이스 언어", textSize:"텍스트 크기", smaller:"작게", larger:"크게", darkMode:"다크 모드", lightMode:"라이트 모드", feedback:"피드백 보내기", auto:"자동(브라우저 언어)", translateMode:"번역 모드", fullPage:"전체 페이지", phrase:"문구", pageHint:"Lingua가 페이지 언어를 감지하여 읽을 수 있는 텍스트를 바로 번역합니다.", phraseHint:"페이지에서 텍스트를 선택하거나 아래에 입력하세요.", from:"번역 원본", to:"번역 대상", original:"원문", translated:"번역문", originalText:"원문", result:"번역이 여기에 표시됩니다.", refresh:"이 페이지 다시 읽기", clear:"텍스트 지우기", copy:"번역 복사", listen:"번역 듣기", detected:"감지됨:", recent:"최근 번역", downloading:"언어 모델 다운로드 중…", translating:"번역 중…", unavailable:"번역을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.", limit:"번역 서비스 한도에 도달했습니다. 잠시 후 다시 시도하세요.", regularPage:"이 페이지를 번역하려면 일반 웹사이트를 여세요." },
};

function supportedBrowserLanguage() {
  const code = (navigator.language || "en").toLowerCase().split("-")[0];
  return STRINGS[code] ? code : "en";
}

export async function createI18n() {
  const saved = await storage.get("app.interface-language", "auto");
  let locale = STRINGS[saved] ? saved : "auto";
  const listeners = new Set();
  const resolved = () => locale === "auto" ? supportedBrowserLanguage() : locale;
  const api = {
    get locale() { return locale; },
    get resolvedLocale() { return resolved(); },
    t(key) { return STRINGS[resolved()]?.[key] ?? STRINGS.en[key] ?? key; },
    languageName(code, fallback = "") {
      if (!code) return fallback;
      for (const displayLocale of [resolved(), "en"]) {
        try {
          const name = new Intl.DisplayNames([displayLocale], {
            type: "language",
            fallback: "none",
          }).of(code);
          if (name) return name;
        } catch {
          // Older Chrome versions may not expose Intl.DisplayNames.
        }
      }
      return fallback || code;
    },
    async setLocale(next) {
      locale = STRINGS[next] ? next : "auto";
      await storage.set("app.interface-language", locale);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return api;
}
