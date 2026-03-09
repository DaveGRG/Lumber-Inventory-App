const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export const links = {
  gmail: isMobile ? 'googlegmail://' : 'https://mail.google.com',
  drive: isMobile ? 'googledrive://' : 'https://drive.google.com',
  buildertrend: isMobile ? 'buildertrend://' : 'https://buildertrend.net/app/Landing',
};
