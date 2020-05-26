const assert = require('assert');

const lib = require('../lib');

module.exports = (testInfo) => {
  it('user info (non-mod)', async function() {
    // test token endpoints
    const result = await testInfo.overlayApi.serverRequest('loki/v1/user_info');
    //console_wrapper.log('user user_info result', result)
    assert.equal(200, result.statusCode);
    assert.ok(result.response);
    assert.ok(result.response.data);
    // we're a freshly created user (hopefully)
    assert.ok(!result.response.data.moderator_status);
    assert.ok(result.response.data.user_id);
    userid = result.response.data.user_id;
  });
}
