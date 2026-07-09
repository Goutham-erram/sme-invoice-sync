import React from 'react';

export default function App({ Component, pageProps }) {
  React.useEffect(() => {
    // Basic CSS Reset inside component to stay in vanilla domain without external file issues
    const style = document.createElement('style');
    style.innerHTML = `
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        background-color: #0a0a0c;
        margin: 0;
        padding: 0;
      }
    `;
    document.head.appendChild(style);
  }, []);

  return <Component {...pageProps} />;
}
