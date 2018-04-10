describe("Contain", () => {
  let webExtension, background, youtubeContainer;

  beforeEach(async () => {
    webExtension = await loadWebExtension();
    background = webExtension.background;
    youtubeContainer = webExtension.youtubeContainer;
  });

  describe("Incoming requests to YouTube Domains outside of YouTube Container", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://www.youtube.com"
      }, {
        responses
      });
    });

    it("should be reopened in YouTube Container", async () => {
      expect(background.browser.tabs.create).to.have.been.calledWithMatch({
        url: "https://www.youtube.com",
        cookieStoreId: youtubeContainer.cookieStoreId
      });
    });

    it("should be canceled", async () => {
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.cancel).to.be.true;
    });
  });

  describe("Incoming requests to Non-YouTube Domains inside YouTube Container", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://example.com",
        cookieStoreId: youtubeContainer.cookieStoreId
      }, {
        responses
      });
    });

    it("should be reopened in Default Container", async () => {
      expect(background.browser.tabs.create).to.have.been.calledWithMatch({
        url: "https://example.com",
        cookieStoreId: "firefox-default"
      });
    });

    it("should be canceled", async () => {
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.cancel).to.be.true;
    });
  });


  describe("Incoming requests that don't start with http", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "ftp://www.youtube.com"
      }, {
        responses
      });
    });

    it("should be ignored", async () => {
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result).to.be.undefined;
    });
  });

  describe("Incoming requests that belong to an incognito tab", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://www.youtube.com",
        incognito: true
      }, {
        responses
      });
    });

    it("should be ignored", async () => {
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result).to.be.undefined;
    });
  });


  describe("Incoming requests that don't belong to a tab", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://www.youtube.com",
        id: -1
      }, {
        responses
      });
    });

    it("should be ignored", async () => {
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result).to.be.undefined;
    });
  });
});