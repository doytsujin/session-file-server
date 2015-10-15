/**
 * Dispatcher is an internal front-facing API for all functions and services
 *
 * "Dialects" will call these functions to the data-access chain to store/retrieve data and format
 * responses in standard way.
 *
 * @module dispatcher
 */

var first_post_id;
var last_post_id;

/** for status reports */
var lmem={ heapUsed: 0 };

/**
 * Helper function for copying entities around
 * @param {string} type - type of entity (mentions, hashtags, links)
 * @param {object} src - source entities array
 * @param {object} dest - destination entities array
 * @param {boolean} postcontext - are we a in a post context (versus user context)
 */
function copyentities(type, src, dest, postcontext) {
  if (!dest) {
    console.log('dispatcher.js::copyentities - dest not set ', dest);
    return;
  }
  // dest.entities[type]=[];
  for(var i in src) {
    var res=src[i];
    var obj=new Object;
    switch(type) {
      case 'mentions':
        // need is_leading only for post context
        if (postcontext && res.altnum!=undefined) {
          obj.is_leading=res.altnum?true:false;
        }
        obj.id=''+res.alt; // could be a hint of future issues here
        obj.name=res.text;
      break;
      case 'hashtags':
        obj.name=res.text;
      break;
      case 'links':
        obj.url=res.alt;
        obj.text=res.text;
        if (res.altnum) {
          obj.amended_len=parseInt(0+res.altnum);
        }
      break;
      default:
        console.log('unknown type '+type);
      break;
    }
    obj.pos=parseInt(0+res.pos);
    obj.len=parseInt(0+res.len);
    dest.entities[type].push(obj);
  }
}

function postsToADN(posts) {
  // data is an array of entities
  var apiposts={}, postcounter=0;
  //console.log('dispatcher.js:getUserPosts - mapping '+posts.length);
  if (posts && posts.length) {
    posts.map(function(current, idx, Arr) {
      //console.log('dispatcher.js:getUserPosts - map postid: '+current.id);
      // get the post in API foromat
      ref.postToAPI(current, function(post, err, postmeta) {
        apiposts[post.id]=post;
        postcounter++;
        // join
        //console.log(apiposts.length+'/'+entities.length);
        if (postcounter==posts.length) {
          //console.log('dispatcher.js::getUserPosts - finishing');
          var res=[];
          for(var i in posts) {
            res.push(apiposts[posts[i].id]);
          }
          callback(res, null, meta);
        }
      });
    }, ref);
  } else {
    // no posts
    callback([], 'no posts for global', meta);
  }
}

var humanFormat=require('human-format');

/** minutely status report */
setInterval(function () {
  var ts=new Date().getTime();
  var mem=process.memoryUsage();
  /*
  regarding: the dispatcher stdout writes (isThisDoingAnything)
  it's pretty compact, only one or two lines per minute
  so finding the exception still shouldn't be an issue
  though they will get further and further apart as the quality of the code gets better
  either case the exceptions need to be logged in a proper log file
  */
  // break so the line stands out from the instant updates
  process.stdout.write("\n");
  console.log("dispatcher @"+ts+" Memory+["+humanFormat(mem.heapUsed-lmem.heapUsed)+"] Heap["+humanFormat(mem.heapUsed)+"] uptime: "+process.uptime());
  lmem=mem;
  ts=null;
}, 60*1000);

// cache is available at this.cache
// we set from API to DB format
// we get from DB format to API
// how much error checking do we need in the get callback?
// should we stop the callback on failure? probably not...
/** @constructs dispatcher */
module.exports = {
  /**
   * cache object for accessing the data store
   * @type {object}
   */
  cache: null,
  /**
   * config object for accessing the config files
   * @type {object}
   */
  config: null,
  /**
   * boolean option for controlling streaming output
   * @type {boolean}
   */
  notsilent: true,
  /** posts */
  // difference between stream and api?
  addPost: function(post, token, callback) {
    this.cache.addPost(post, token, callback);
  },
  /**
   * Add/Update post in data store
   * @param {object} post - the new post object
   * @param {setPostCallback} callback - function to call after completion
   */
  setPost: function(post, callback) {
    if (!post) {
      console.log('dispatcher.js::setPost - post is not set!');
      if (callback) {
        callback(null, 'setPost - post is not set!');
      }
      return;
    }
    if (!post.id) {
      console.log('dispatcher.js::setPost - no id in post', post);
      if (callback) {
        callback(null, 'setPost - no id in post');
      }
      return;
    }

    // we're assuming we're getting a contiguous amount of posts...
    // get a sample of where the app stream is starting out
    if (first_post_id==undefined) {
      // not a good way to do this,
      // some one can interact (delete?) an older post with a much lower id
      console.log("Setting first post to ", post.id);
      first_post_id=post.id;
    }

    post.date=new Date(post.created_at);
    post.ts=post.date.getTime();

    // update user first, to avoid proxy
    if (post.user && post.user.id) {
      // update User records
      /*
      if (post.user.description && post.user.description.entities) {
        console.log('disptacher.js::setPost '+post.id+' has user entites');
      } else {
        console.log('disptacher.js::setPost '+post.id+' has NO user entites');
        //console.dir(post.user);
      }
      */
      this.updateUser(post.user, post.ts, function(user, err) {
        if (err) {
          console.log("User Update err: "+err);
        //} else {
          //console.log("User Updated");
        }
      });
    }
    if (post.entities) {
      this.setEntities('post', post.id, post.entities, function(entities, err) {
        if (err) {
          console.log("entities Update err: "+err);
        //} else {
          //console.log("entities Updated");
        }
      });
    }
    //console.log('dispatcher.js::setPost post id is '+post.id);
    var dataPost=post;
    //dataPost.id=post.id; // not needed
    if (post.user) {
      dataPost.userid=post.user.id;
    } else {
      // usually on deletes, they don't include the user object
      //console.log('No Users on post ', post);
      /*
{ created_at: '2013-08-16T01:10:29Z',
  num_stars: 0,
  is_deleted: true,
  num_replies: 0,
  thread_id: '9132210',
  deleted: '1',
  num_reposts: 0,
  entities: { mentions: [], hashtags: [], links: [] },
  machine_only: false,
  source:
   { link: 'http://tapbots.com/software/netbot',
     name: 'Netbot for iOS',
     client_id: 'QHhyYpuARCwurZdGuuR7zjDMHDRkwcKm' },
  reply_to: '9132210',
  id: '9185233',
  date: Thu Aug 15 2013 18:10:29 GMT-0700 (PDT),
  ts: 1376615429000 }
      */
    }
    dataPost.created_at=new Date(post.created_at); // fix incoming created_at iso date to Date
    if (post.source) {
      var ref=this;
      this.cache.setSource(post.source, function(client, err) {
        // param order is correct
        //console.log('addPost setSource returned ', client, err, dataPost);
        if (err) {
          console.log('can\'t setSource', err);
        } else {
          dataPost.client_id=client.client_id;
        }
        //console.log('dispatcher.js::setPost datapost id is '+dataPost.id);
        ref.cache.setPost(dataPost, callback);
      });
    } else {
      //console.log('dispatcher.js::setPost datapost id is '+dataPost.id);
      this.cache.setPost(dataPost, callback);
    }

    if (post.annotations) {
      this.setAnnotations('post', post.id, post.annotations);
    }

    if (last_post_id==undefined || post.id>last_post_id) {
      //console.log("Setting last post to ", post.id);
      last_post_id=post.id;
    }
    if (this.notsilent) {
      process.stdout.write('P');
    }
  },
  // convert ADN format to DB format
  apiToPost: function(api, meta, callback) {
    if (!api.user) {
      console.log('apiToPost - api user is missing', api.user,api);
      callback(null, 'no api user');
      return;
    }
    // copy api
    var post=JSON.parse(JSON.stringify(api));
    post.date=new Date(api.created_at);
    post.ts=post.date.getTime();
    post.user.created_at=new Date(api.user.created_at);
    post.userid=api.user.id;
    // repost_of?
    // it's an object in api and an numericid in DB
    if (api.repost_of) {
      post.repost_of=api.repost_of.id
    }
    // source
    if (post.source) {
      var ref=this;
      // find it (or create it for caching later)
      this.cache.setSource(post.source, function(client, err) {
        if (err) {
          console.log('can\'t setSource ', err);
        } else {
          post.client_id=client.client_id;
        }
        callback(post, err, meta);
      });
    } else {
      callback(post, null, meta);
    }
    //return post;
  },
  /**
   * convert DB format to API structure
   * @param {object} post - the new post object
   * @param {setPostCallback} callback - function to call after completion
   * @param {object} meta - the meta data
   */
  postToAPI: function(post, callback, meta) {
    if (!post) {
      callback(null, 'dispatcher.js::postToAPI - no post data passed in');
      return;
    }
    var ref=this;
    //console.log('dispatcher.js::postToAPI - gotPost. post.userid:', post.userid);
    // post.client_id is string(32)
    //console.log('dispatcher.js::postToAPI - gotUser. post.client_id:', post.client_id);

    var finalcompsite=function(post, user, client, callback, err, meta) {
      // copy source (client_id) structure
      // explicitly set the field we use

      var data={};

      var postFields=['id', 'text', 'html', 'canonical_url', 'created_at', 'machine_only', 'num_replies', 'num_reposts', 'num_stars', 'thread_id', 'entities', 'source', 'user'];
      for(var i in postFields) {
        var f=postFields[i];
        data[f]=post[f];
      }
      // convert TS to date object
      data.created_at=new Date(data.created_at);
      //console.log(post.num_replies+' vs '+data.num_replies);
      var postFieldOnlySetIfValue=['repost_of', 'reply_to'];
      for(var i in postFieldOnlySetIfValue) {
        var f=postFieldOnlySetIfValue[i];
        if (post[f]) {
          data[f]=post[f];
        }
      }
      data.user=user;
      //console.log('dispatcher.js::postToAPI - Done, calling callback');
      // now fix up reposts
      if (post.repost_of) {
        //console.log('converting repost_of from ', post.repost_of);
        ref.getPost(post.repost_of.id, null, function(repost, err, meta) {
          //console.log('converting repost_of to', repostapi.id);
          data.repost_of=repost;
          callback(data, err, meta);
        })
      } else {
        callback(data, err, meta);
      }
    }

    // we need post, entities, annotations
    // user, entities, annotations
    // and finally client
    // could dispatch all 3 of these in parallel
    // shouldAdd but can't no name/link data
    ref.getClient(post.client_id, function(client, clientErr, clientMeta) {
      //console.log('dispatcher.js::postToAPI - gotClient. post.id:', post.id);

      if (client) {
        post.source={
          link: client.link,
          name: client.name,
          client_id: client.client_id
        };
      } else {
        console.log('dispatcher.js::postToAPI('+post.id+') - client is ', client, clientErr);
      }

      //console.log('dispatcher.js::postToAPI - is ref this?', ref);
      //console.log('dispatcher.js::postToAPI('+post.id+') - getting user '+post.userid);
      ref.getUser(post.userid, null, function(user, err) {
        //console.log('dispatcher.js::postToAPI('+post.id+') - got user '+post.userid, err);
        // use entity cache
        if (1) {
          //console.log('dispatcher.js::postToAPI('+post.id+') - getEntity post. post.userid:', post.userid);
          ref.getEntities('post', post.id, function(entities, entitiesErr, entitiesMeta) {
            //console.log('dispatcher.js::postToAPI('+post.id+') - gotEntities');

            post.entities={
              mentions: [],
              hashtags: [],
              links: [],
            };
            copyentities('mentions', entities.mentions, post, 1);
            copyentities('hashtags', entities.hashtags, post, 1);
            copyentities('links', entities.links, post, 1);
            // use html cache
            if (1) {
              //console.log('dispatcher.js::postToAPI('+post.id+') - calling final comp');
              finalcompsite(post, user, client, callback, err, meta);
            } else {
              // generate HTML
              ref.textProcess(post.text, function(textProcess, err) {
                //console.dir(textProcess);
                post.html=textProcess.html;
                finalcompsite(post, user, client, callback, err, meta);
              }, post.entities);
            }
          }); // getEntities
        } else {
          ref.textProcess(post.text, function(textProc, err) {
            post.entities=textProc.entities;
            post.html=textProc.html;
            finalcompsite(post, user, client, callback, err, meta);
          }, null, 1);
        }
      }); // getUser
    }); // getClient
  },
  addRepost: function(postid, token, callback) {
    this.cache.addRepost(postid, token, callback);
  },
  delRepost: function(postid, token, callback) {
    this.cache.delRepost(postid, token, callback);
  },
  /**
   * get single post from data access
   * @param {number} id - the new post object
   * @param {object} params - the options context
   * @param {metaCallback} callback - function to call after completion
   */
  getPost: function(id, params, callback) {
    // probably should just exception and backtrace
    if (callback==undefined) {
      console.log('dispatcher.js::getPost - callback undefined');
      return;
    }
    if (id==undefined) {
      callback(null, 'dispatcher.js::getPost - id is undefined');
    }
    var ref=this;
    this.cache.getPost(id, function(post, err, meta) {
      if (post) {
        ref.postToAPI(post, callback, meta);
      } else {
        callback(null, 'dispatcher.js::getPost - post is not set!');
      }
    });
  },
  // threadid or reply_to? reply_to for now
  getReplies: function(postid, params, token, callback) {
    var ref=this;
    // userid can't be me without a token
    // userid could be a username though
    this.cache.getPost(postid, function(post, err) {
      downloader.downloadThread(post.thread_id, token);
      ref.cache.getReplies(post.thread_id, params, token, function(posts, err, meta) {
        //console.log('dispatcher.js::getReplies - returned meta ', meta);
        // data is an array of entities
        var apiposts={}, postcounter=0;
        //console.log('dispatcher.js:getReplies - mapping '+posts.length);
        if (posts && posts.length) {
          posts.map(function(current, idx, Arr) {
            //console.log('dispatcher.js:getReplies - map postid: '+current.id);
            // get the post in API foromat
            ref.postToAPI(current, function(post, err, postmeta) {
              // can error out
              if (post) {
                apiposts[post.id]=post;
              }
              // always increase counter
              postcounter++;
              // join
              //console.log(apiposts.length+'/'+entities.length);
              if (postcounter==posts.length) {
                //console.log('dispatcher.js::getReplies - finishing');
                // need to restore original order
                var res=[];
                for(var i in posts) {
                  if (posts[i]) {
                    res.push(apiposts[posts[i].id]);
                  }
                }
                //console.log('dispatcher.js::getReplies - result ', res);
                callback(res, null, meta);
              }
            });
          }, ref);
        } else {
          // no posts
          console.log('dispatcher.js:getReplies - no replies ');
          callback([], 'no posts for replies', meta);
        }
      });
    });
  },
  getMentions: function(userid, params, token, callback) {
    var ref=this;
    // is this blocking execution? yes, I think it is
    this.cache.getUser(userid, function(user, err) {
      if (user.following==0) {
        console.log('downloadMentions');
        downloader.downloadMentions(userid, params, token);
        console.log('downloadMentions complete');
      }
    });
    // userid can't be me without a token
    // userid could be a username though
    this.cache.getMentions(userid, params, function(entities, err, meta) {
      // data is an array of entities
      var apiposts={};
      var count=0;
      console.log('dispatcher.js:getMentions - mapping',entities.length);
      if (entities && entities.length) {
        //for(var i in entities) {
          //console.log('i',entities[i].typeid);
        //}
        entities.map(function(current, idx, Arr) {
          // get the post in API foromat
          //console.log('getting post',current.typeid);
          ref.getPost(current.typeid, null, function(post, perr, pmeta) {
            //console.log('got post',post.id);
            apiposts[post.id]=post;
            count++;
            // join
            console.log(count+'/'+entities.length,'post',post.id,'entity',current.id);
            if (count==entities.length) {
              console.log('dispatcher.js::getMentions - finishing',meta);
              // restore order
              var nlist=[];
              for(var i in entities) {
                nlist.push(apiposts[entities[i].typeid]);
              }
              callback(nlist, err, meta);
            }
          });
        }, ref);
      } else {
        // no entities
        callback([], 'no mentions/entities for '+userid, meta);
      }
    });
  },
  /**
   * get range of posts from data access
   * @param {object} params - the pagination context
   * @param {metaCallback} callback - function to call after completion
   */
  getGlobal: function(params, callback) {
    var ref=this;
    this.cache.getGlobal(params, function(posts, err, meta) {
      //console.log('dispatcher.js::getGlobal - returned meta', meta);
      // data is an array of entities
      var apiposts={}, postcounter=0;
      //console.log('dispatcher.js:getGlobal - mapping', posts.length);
      if (posts.length) {
        posts.map(function(current, idx, Arr) {
          //console.log('dispatcher.js:getGlobal - map postid: '+current.id);
          // get the post in API foromat
          ref.postToAPI(current, function(post, err, postmeta) {
            // can error out
            if (post) {
              apiposts[post.id]=post;
            }
            // always increase counter
            postcounter++;
            // join
            //console.log(apiposts.length+'/'+entities.length);
            if (postcounter==posts.length) {
              //console.log('dispatcher.js::getGlobal - finishing');
              // need to restore original order
              var res=[];
              for(var i in posts) {
                if (posts[i]) {
                  res.push(apiposts[posts[i].id]);
                }
              }
              callback(res, null, meta);
            }
          });
        }, ref);
      } else {
        // no posts
        callback([], 'no posts for global', meta);
      }
    });
  },
  /**
   * get explore streams
   * @param {object} params - the pagination context
   * @param {metaCallback} callback - function to call after completion
   */
  getExplore: function(params, callback) {
    var ref=this;
    this.cache.getExplore(params, function(endpoints, err, meta) {
      //console.log('dispatcher.js::getExplore - returned meta', meta);
      callback(endpoints, null, meta);
    });
  },
  getUserStream: function(user, params, token, callback) {
    var ref=this;
    //console.log('dispatcher.js::getUserStream', user);
    this.cache.getUser(user, function(userdata, err, meta) {
      ref.cache.getFollowing(user, {}, function(followings, err) {
        console.log('user counts check', userdata.following, 'vs', followings.length);
        if (userdata.following==0 || followings.length==0 || userdata.following>followings.length) {
          console.log('likely we need to sync followers for',user);
          downloader.downloadFollowing(user, token);
        }
      });
    });
    // ok actually build the stream
    if (params.count===undefined) params.count=20;
    if (params.before_id===undefined) params.before_id=-1; // -1 being the very end
    var oldcount=params.count;
    // but we want to make sure it's in the right direction
    // if count is positive, then the direction is older than the 20 oldest post after before_id
    params.count+=1; // add one at the end to check if there's more
    // before_id
    console.log('dispatcher.js::getUserStream - count',params.count);
    this.cache.getUserStream(user, params, token, function(posts, err, meta) {
      // data is an array of entities
      var apiposts={}, postcounter=0;
      //if (posts) console.log('dispatcher.js:getUserPosts - mapping '+posts.length);
      if (posts && posts.length) {
        var min_id=posts[0].id+200,max_id=0;
        posts.map(function(current, idx, Arr) {
          //console.log('dispatcher.js:getUserPosts - map postid: '+current.id);
          // get the post in API foromat
          ref.postToAPI(current, function(post, err, postmeta) {
            min_id=Math.min(min_id,post.id);
            max_id=Math.max(max_id,post.id);
            apiposts[post.id]=post;
            postcounter++;
            // join
            //console.log(apiposts.length+'/'+entities.length);
            // -1 because we asked for an extra
            // but is that extra in the front or back?
            if (postcounter==posts.length-1) {
              //console.log('dispatcher.js::getUserStream - finishing');
              var imeta={
                code: 200,
                min_id: min_id,
                max_id: max_id,
                more: posts.length==params.count
              };
              var res=[];
              // well not all of them...
              for(var i in posts) {
                // well not all of them...
                if (apiposts[posts[i].id]) {
                  res.push(apiposts[posts[i].id]);
                }
              }
              console.log('meta',meta);
              console.log('imeta',imeta);
              callback(res, null, imeta);
            }
          });
        }, ref);
      } else {
        // no posts
        callback([], 'no posts for global', meta);
      }
    });
  },
  getUnifiedStream: function(user, params, token, callback) {
    console.log('dispatcher.js::getUnifiedStream', user);
    var ref=this;
    this.cache.getUnifiedStream(user, params, token, function(posts, err) {
      // data is an array of entities
      var apiposts={}, postcounter=0;
      //console.log('dispatcher.js:getUserPosts - mapping '+posts.length);
      if (posts && posts.length) {
        posts.map(function(current, idx, Arr) {
          //console.log('dispatcher.js:getUserPosts - map postid: '+current.id);
          // get the post in API foromat
          ref.postToAPI(current, function(post, err, postmeta) {
            apiposts[post.id]=post;
            postcounter++;
            // join
            //console.log(apiposts.length+'/'+entities.length);
            if (postcounter==posts.length) {
              //console.log('dispatcher.js::getUserPosts - finishing');
              var res=[];
              for(var i in posts) {
                res.push(apiposts[posts[i].id]);
              }
              callback(res, null, meta);
            }
          });
        }, ref);
      } else {
        // no posts
        callback([], 'no posts for global', meta);
      }
    });
    //console.log('dispatcher.js::getUnifiedStream - write me');
    //callback(null, null);
  },
  /**
   * get range of posts for user id userid from data access
   * @param {number} userid - the user id to get posts for
   * @param {object} params - the pagination context
   * @param {metaCallback} callback - function to call after completion
   */
  getUserPosts: function(userid, params, callback) {
    //console.log('dispatcher.js::getUserPosts - userid: '+userid);
    var ref=this;
    this.cache.getUserPosts(userid, params, function(posts, err, meta) {
      // data is an array of entities
      var apiposts={}, postcounter=0;
      //console.log('dispatcher.js:getUserPosts - mapping '+posts.length);
      if (posts && posts.length) {
        posts.map(function(current, idx, Arr) {
          //console.log('dispatcher.js:getUserPosts - map postid: '+current.id);
          // get the post in API foromat
          ref.postToAPI(current, function(post, err, postmeta) {
            apiposts[post.id]=post;
            postcounter++;
            // join
            //console.log(apiposts.length+'/'+entities.length);
            if (postcounter==posts.length) {
              //console.log('dispatcher.js::getUserPosts - finishing');
              var res=[];
              for(var i in posts) {
                res.push(apiposts[posts[i].id]);
              }
              callback(res, null, meta);
            }
          });
        }, ref);
      } else {
        // no posts
        callback([], 'no posts for global', meta);
      }
    });
  },
  /**
   * get range of stared posts for user id userid from data access
   * @param {number} userid - the user id to get posts for
   * @param {object} params - the pagination context
   * @param {metaCallback} callback - function to call after completion
   */
  getUserStars: function(userid, params, callback) {
    //console.log('dispatcher.js::getUserStars start');
    if (!params.count) params.count=20;
    var ref=this;
    this.cache.getInteractions('star', userid, params, function(interactions, err, meta) {
      //console.log('dispatcher.js::getUserStars - ', interactions);
      // data is an array of interactions
      if (interactions && interactions.length) {
        var apiposts=[];
        interactions.map(function(current, idx, Arr) {
          // we're a hasMany, so in theory I should be able to do
          // record.posts({conds});
          // get the post in API foromat
          ref.getPost(current.typeid, null, function(post, err, meta) {
            //console.dir(post);
            if (post && post.user && post.text) { // some are deleted, others are errors
              apiposts.push(post);
            } else {
              interactions.pop();
            }
            // join
            //console.log(apiposts.length+'/'+interactions.length+' or '+params.count);
            if (apiposts.length==params.count && apiposts.length==interactions.length) {
              //console.log('dispatcher.js::getUserStars - finishing');
              callback(apiposts);
              return; // kill map, somehow?
            }
          });
        }, ref);
      } else {
        // no interactions
        callback([], err, meta);
      }
    });
  },
  /**
   * get range of hashtagged posts from data access
   * @param {string} hashtag - the hashtag to get posts for
   * @param {object} params - the pagination context
   * @param {metaCallback} callback - function to call after completion
   */
  getHashtag: function(hashtag, params, callback) {
    var ref=this;
    //console.log('dispatcher.js:getHashtag - start #'+hashtag);
    this.cache.getHashtagEntities(hashtag, params, function(entities, err, meta) {
      // data is an array of entities
      var apiposts=[];
      //console.log('dispatcher.js:getHashtag - mapping '+entities.length);
      if (entities.length) {
        entities.map(function(current, idx, Arr) {
          // get the post in API foromat
          ref.getPost(current.typeid, null, function(post, err, meta) {
            apiposts.push(post);
            // join
            //console.log(apiposts.length+'/'+entities.length);
            if (apiposts.length==entities.length) {
              //console.log('dispatcher.js::getHashtag - finishing');
              callback(apiposts);
            }
          });
        }, ref);
      } else {
        // no entities
        callback([], 'no entities for '+hashtag, meta);
      }
    });
  },
  getExploreFeed: function(feed, params, callback) {
    var ref=this;
    this.cache.getExploreFeed(feed, params, function(posts, err) {
      var apiposts=[];
      if (posts.length) {
        posts.map(function(current, idx, Arr) {
          // get the post in API foromat
          //console.log('getting',current.id);
          ref.getPost(current.id, null, function(post, err, meta) {
            if (post && post.text) {
              apiposts.push(post);
            } else {
              console.log('no post', post, err, meta, current.id);
              posts.pop();
            }
            // join
            //console.log(apiposts.length+'/'+entities.length);
            if (apiposts.length==posts.length) {
              //console.log('dispatcher.js::getExploreFeed - finishing');
              callback(apiposts);
            }
          });
        }, ref);
      } else {
        // no entities
        callback([], 'no posts for '+feed, meta);
      }
    });
  },
  /** channels */
  /**
   * add/update channel
   * @param {object} json - channel object data
   * @param {number} ts - the timestamp of this event
   * @param {metaCallback} callback - function to call after completion
   */
  setChannel: function(json, ts, callback) {
    if (!json) {
      console.log('dispatcher.js::setChannel - no json passed in');
      callback(null, 'no json passed in');
      return;
    }
    var ref=this;
    // map API to DB
    // default to most secure
    var raccess=2; // 0=public, 1=loggedin, 2=selective
    var waccess=2; // 1=loggedin, 2=selective
    // editors are always seletcive
    if (json.readers.any_user) {
      raccess=1;
    }
    if (json.readers.public) {
      raccess=0;
    }
    if (json.writers.any_user) {
      waccess=1;
    }
    var channel={
      id: json.id,
      ownerid: json.owner.id,
      type: json.type,
      reader: raccess,
      writer: waccess,
      readers: json.readers.user_ids,
      writers: json.writers.user_ids,
      editors: json.editors.user_ids,
    };
    // update user object
    this.updateUser(json.owner, ts);
    this.cache.setChannel(channel, ts, function(chnl, err) {
      // if newer update annotations
      if (callback) {
        callback(chnl, err);
      }
    });
    if (this.notsilent) {
      process.stdout.write('C');
    }
  },
  /**
   * get channel data for specified channel id
   * @param {number} id - the id of channel you're requesting
   * @param {object} param - channel formatting options
   * @param {metaCallback} callback - function to call after completion
   */
  getChannel: function(id, params, callback) {
    this.cache.getChannel(id, callback);
  },
  //
  // messages
  //
  /**
   * add/update message
   * @param {object} json - message object data
   * @param {number} ts - the timestamp of this event
   * @param {metaCallback} callback - function to call after completion
   */
  setMessage: function(json, ts, callback) {
    //console.log('dispatcher.js::setMessage - write me!');
    // update user object
    // if the app gets behind (and/or we have mutliple stream)
    // the message could be delayed, so it's better to tie the user timestamp
    // for when the message was created then now
    // if though the user object maybe be up to date when the packet was sent
    // however the delay in receiving and processing maybe the cause of delay
    // meta.timestamp maybe the most accurate here?
    this.updateUser(json.user, ts);
    // create message DB object (API=>DB)
    var message={
      id: json.id,
      channelid: json.channel_id,
      text: json.text,
      html: json.html,
      machine_only: json.machine_only,
      client_id: json.client_id,
      thread_id: json.thread_id,
      userid: json.user.id,
      reply_to: json.reply_to,
      is_deleted: json.is_deleted,
      created_at: json.created_at
    };
    this.cache.setMessage(message, function(msg, err) {
      // if current, extract annotations too
      if (callback) {
        callback(msg, err);
      }
    });
    if (this.notsilent) {
      process.stdout.write('M');
    }
  },
  /**
   * get messages for specified channel id
   * @param {number} cid - the id of channel you're requesting
   * @param {object} param - message formatting options
   * @param {metaCallback} callback - function to call after completion
   */
  getChannelMessages: function(cid, params, callback) {
    this.cache.getChannelMessages(cid, params, callback);
  },
  /**
   * get messages for specified message ids on specified channel
   * @param {number} cid - the id of channel you're requesting
   * @param {array} mids - the ids of messaes you're requesting
   * @param {object} param - message formatting options
   * @param {metaCallback} callback - function to call after completion
   */
  getChannelMessage: function(cid, mids, params, callback) {
    console.log('dispatcher.js::getChannelMessage - write me!');
    callback([], null);
  },
  //
  // channel_subscription
  //
  /**
   * add/update channel subscription
   * @param {object} data - subscription data
   * @param {boolean} deleted - subscribe/unscribe
   * @param {number} ts - the timestamp of the event
   * @param {metaCallback} callback - function to call after completion
   */
  setChannelSubscription: function(data, deleted, ts, callback) {
    // update user object
    if (data.user) {
      this.updateUser(data.user, ts);
    }
    // update channel object
    this.setChannel(data.channel, ts);
    // update subscription
    this.cache.setSubscription(data.channel.id, data.user.id, deleted, ts, callback);
    if (this.notsilent) {
      process.stdout.write(deleted?'s':'S');
    }
  },
  /**
   * get subscriptions for specified user id
   * @param {number} userid - the id of user you're requesting
   * @param {object} param - channel formatting options
   * @param {metaCallback} callback - function to call after completion
   */
  getUserSubscriptions: function(userid, params, callback) {
    this.cache.getUserSubscriptions(userid, params, callback);
  },
  /**
   * get subscriptions for specified channel id
   * @param {number} channelid - the id of channel you're requesting
   * @param {object} param - user formatting options
   * @param {metaCallback} callback - function to call after completion
   */
  getChannelSubscriptions: function(channelid, params, callback) {
    this.cache.getChannelSubscriptions(channelid, params, callback);
  },
  //
  // stream_marker
  //
  /**
   * add/update stream marker
   * @todo spec out proper prototype
   * @todo implement function
   * @param {object} data - stream marker data object
   */
  setStreamMakerdata: function(data) {
    console.log('dispatcher.js::setStreamMakerdata - write me!');
    if (callback) {
      callback(null, null);
    }
  },
  //
  // user token
  //
  // so we need access to the session store
  // or some way to get context
  /**
   * get current context user token
   * @param {metaCallback} callback - function to call after completion
   */
  getToken: function(userid, client_id, callback) {
    // we could lookup unique token by userid/client_id
    // dummy token
    this.getUser(userid, null, function(user, err) {
      var token={
        app: {
          client_id: client_id,
          link: "http://foo.example.com",
          name: "Test app",
        },
        scopes: [
          "stream",
          "messages",
          "export",
          "write_post",
          "follow"
        ],
        limits: {
          "following": 40,
          "max_file_size": 10000000
        },
        "storage": {
          "available": 8787479688,
          "used": 1212520312
        },
        user: user,
        "invite_link": "https://join.app.net/from/notareallink"
      };
      callback(token, null);
    });
  },
  getUserClientByToken: function(token, callback) {
    this.cache.getAPIUserToken(token, callback);
  },
  /**
   * add/update user token
   * @param {number} userid - owner of token
   * @param {string} client_id - client token is for
   * @param {array} scopes - token scope
   * @param {string} token - upstream token
   */
  // FIXME: store downstream token, so we can look it up later!
  setToken: function(userid, client_id, scopes, token, callback) {
    // function(userid, client_id, scopes, token, callback)
    this.cache.addAPIUserToken(userid, client_id, scopes, token, callback);
  },
  //
  // star (interaction)
  //
  // id is meta.id, not sure what this is yet
  addStar: function(postid, token, callback) {
    this.cache.addStar(postid, token, callback);
  },
  delStar: function(postid, token, callback) {
    this.cache.delStar(postid, token, callback);
  },
  /**
   * add/update star
   * @param {object} data - stream star object
   * @param {boolean} deleted - star/unstar
   * @param {number} ts - timestamp of event
   * @param {metaCallback} callback - function to call after completion
   */
  setStar: function(data, deleted, id, ts, callback) {
    // and what if the posts doesn't exist in our cache?
    // update post
    // yea, there was one post that didn't has post set
    if (data && data.post) {
      this.setPost(data.post);
    }
    // update user record
    if (data && data.user && data.user.username) {
      this.updateUser(data.user, ts);
    }
    // create/update star
    if (data) {
      // we don't need source user because that'll be in the post
      // though maybe able to remove a look up if we pass it
      this.cache.setInteraction(data.user.id, data.post.id, 'star', id, deleted, ts, callback);
    } else {
      if (deleted) {
        this.cache.setInteraction(0, 0, 'star', id, deleted, ts, callback);
      } else {
        console.log('dispatcher.js::setStar - Create empty?');
        if (callback) {
          callback(null, null);
        }
      }
    }
    if (this.notsilent) {
      process.stdout.write(deleted?'_':'*');
    }
  },
  /**
   * get interactions from data access
   * @param {metaCallback} callback - function to call after completion
   */
  getInteractions: function(userid, token, params, callback) {
    var ref=this;
    this.getUser(userid, null, function(user, err) {
      // o(3) maybe 4 if toApi
      console.log('getInteractions - gotUser');
      ref.cache.getNotices(userid, { count: 20 }, function(notices, err) {
        console.log('getInteractions - gotNotice',notices);
        // actionuserid <= may have to look this up too
        // look up: notice.postid => post
        // look up: post.user.id => post.user
        // we can roll up multiple entries for same type and post objects
        var interactions=[];
        for(var i in notices) {
          var notice=notices[i];
          if (notice.type==='follow') {
            // follow, look up user
            // if we use use the dispatcher one then we don't need to conver it
            ref.getUser(notice.typeid, function(fuser, err) {
              interactions.push({
                  "event_date": notice.event_date,
                  "action": 'follow',
                  "objects": [
                    user
                  ],
                  "users": [
                    fuser
                  ]
              });
              if (interactions.length==notices.length) {
                console.log('getInteractions - calling back');
                callback(interactions, err);
              }
            });
          } else {
            // not follow, look up post
            // if we use use the dispatcher one then we don't need to conver it
            ref.getPost(notice.typeid, {}, function(post, err) {
              interactions.push({
                  "event_date": notice.event_date,
                  "action": notice.type,
                  "objects": [
                    post
                  ],
                  "users": [
                    post.user
                  ]
              });
              if (interactions.length==notices.length) {
                console.log('getInteractions - calling back');
                callback(interactions, err);
              }
            });
          }
        }
        console.log('getInteractions - done');
        //callback(interactions, err);
      });
    });
  },
  getInteractions2: function(userid, token, params, callback) {
    // probably will needs params
    // if each returns 0-count, that should be more than enough to fulfill count
    // 4xcount but let's say we get less than count, that means there isn't the data
    // so we can't provide more
    var interactions=[]; // [ts, {}]
    // get a list of interactions for this user
    // interactions are follows = users
    // stars, reposts, reply = posts
    // welcome will be empty
    // broadcast_create, broadcast_subscribe, broadcast_subscribe will be channels
    // build a list sorted by timestamp
    var ref=this;
    var done_follows=0;
    var done_stars=0;
    var done_reposts=0;
    var done_replies=0;
    //var list=[]; // (timestamp, action, objects, users)
    var sent=0;
    var checkdone=function() {
      if (sent) return;
      var list=followlist.concat(starlist).concat(repostlist).concat(replieslist);
      console.log('dispatcher.js::getInteractions check', done_follows, done_stars, done_reposts, done_replies, 'items', list.length);
      if (done_follows && done_stars && done_reposts && done_replies) {
        //console.log('dispatcher.js::getInteractions done');
        sent=1; // sent lock
        //ref.getUser(userid, null, function(self, err) {
          //console.log('self');
          /*
          ref.getUser(2, null, function(actor, err) {
            //console.log('berg');
            var interaction={
                "action": "follow",
                "event_date": "2012-07-16T17:23:34Z",
                "objects": [
                  self
                ],
                "users": [
                  actor
                ]
            };
            // pagination_id
            //console.log('sending back');
            callback([interaction], null);
          });
          */
          // since we only need count (20)
          // let's only do the getUser here
          var interactions=[];
          console.log('dispatcher.js::getInteractions - list len',list.length);
          // so the way node works is that if we have 900 items
          // we have to issue all 900 items before we'll get one response
          for(var i in list) {
            if (i>20) break;
            // yield and then run this
            //setImmediate(function() {
              ref.getUser(list[i][3], null, function(fuser, err) {
                var interaction={
                    "event_date": list[i][0],
                    "action": list[i][1],
                    "objects": [
                      list[i][2]
                    ],
                    "users": [
                      fuser
                    ]
                };
                //console.log(interaction.objects,interaction.users);
                interactions.push(interaction);
                console.log('i',i,'len',interactions.length);
                if (interactions.length==list.length || interactions.length==20) {
                  // 16-70s on 54posts 0 followers
                  console.log('sending');
                  callback(interactions, null);
                }
              });
            //});
          }
          console.log('for is done, waiting on getUser');
          //console.log('sending',interactions.length);
          //callback(interactions, null);
        //});
      }
    }
    // follows
    var followlist=[]
    var followexpect=0;
    // only need the most recent 20 follows
    console.log('getting followers for', userid);
    // lookup self first, and then get down to business
    this.getUser(userid, null, function(user, err) {
      ref.cache.getFollows(userid, { count: 20 }, function(follows, err) {
        if (!follows.length) {
          done_follows=1;
          checkdone();
        } else {
          for(var i in follows) {
            var follow=follows[i];
            if (follow.active) {
              followexpect++;
              done_follows=0;
              //console.log('expecting',followexpect);
              //ref.getUser(follow.userid, null, function(fuser, err) {
                followlist.push([follow.last_updated, 'follow', user, follow.userid])
                //console.log('got',followlist.length,'vs',followexpect);
                if (followlist.length==followexpect) {
                  // move it into the main list
                  done_follows=1;
                  checkdone();
                }
              //});
            }
          }
          if (followexpect===0) {
            console.log('no active followers');
            done_follows=1;
          }
          checkdone();
        }
      });
    });
    // stars
    var starlist=[]
    // not that I starred a post...
    /*
    this.cache.getInteractions('star', userid, { count: 20 }, function(stars, err) {
      if (!stars.length) {
        done_stars=1;
      } else {
        for(var i in stars) {
          var star=stars[i];
          ref.getUser(userid, null, function(user, err) {
            ref.getPost(star.typeid, null, function(post, err) {
              starlist.push([star.datetime, 'star', post, user])
              console.log('*i',i,'vs',stars.length,'vs',starlist.length,'starlist');
              if (starlist.length==stars.length) {
                // move it into the main list
                done_stars=1;
                checkdone();
              }
            });
          });
        }
      }
      checkdone();
    });
    */
    var repostlist=[]
    var replieslist=[]
    // can't count 20, we want any activity on all our posts
    this.getUserPosts(userid, { }, function(posts, err) {
      if (!posts.length) {
        console.log('no posts');
        done_reposts=1;
        done_replies=1;
        done_stars=1;
        checkdone();
        return;
      }
      var repostcount=0;
      var replycount=0;
      var starcount=0;
      var postrepostcalls=0;
      var postreplycalls=0;
      var poststarcalls=0;
      console.log('posts',posts.length);
      var postcalls=0;
      for(var i in posts) {
        var post=posts[i];
        // skip delete posts...
        if (post.deleted) continue;
        postcalls++;
        // reposts
        // get a list of all my posts, did any of them were a repost_of
        // up to 20 reposts (as long as their reposts replies)
        ref.cache.getReposts(post.id, { count: 20 }, token, function(reposts, err) {
          /*
          if (!reposts.length) {
            console.log('well no resposts, let\'s check on things. posts: ',postcalls,'postrepostcalls',postrepostcalls);
          }
          */
            //done_reposts=1;
          //} else {
          repostcount+=reposts.length;
          for(var j in reposts) {
            var repost=reposts[j];
            //ref.getUser(repost.userid, null, function(ruser, err) {
              repostlist.push([repost.created_at, 'repost', post, repost.userid])
              //console.log('Pi',i,'vs',posts.length);
              console.log('repost check',repostlist.length,'vs',repostcount,'repostcalls',postrepostcalls,'/',postcalls);
              if (repostlist.length==repostcount && postcalls==postrepostcalls) {
                // move it into the main list
                // we're hitting this early
                done_reposts=1;
                checkdone();
              }
            //});
          }
          postrepostcalls++;
          if (postrepostcalls==postcalls) {
            // we're done, there maybe repostcount outstanding, let's check
            console.log('repost done, count:',repostcount,'done:',repostlist.length);
            // if we never requested anything, then we're done
            if (!repostcount || repostcount==repostlist.length) {
              done_reposts=1;
              checkdone();
            }
          }
          //}
        });
        // replys
        // get a list of all my posts, reply_to
        //console.log('Calling getReplies');
        // up to 20 replies (as long as their recent replies)
        ref.cache.getReplies(post.id, { count: 20 }, token, function(replies, err) {
          //if (!replies.length) {
            //done_replies=1;
          //} else {
          replycount+=replies.length;
          for(var j in replies) {
            var reply=replies[j];
            //ref.getUser(reply.userid, null, function(ruser, err) {
              replieslist.push([reply.created_at, 'reply', post, reply.userid])
              //console.log('Li',i,'vs',posts.length);
              console.log('reply check',replieslist.length,'vs',replycount,'replycalls',postreplycalls,'/',postcalls);
              if (replieslist.length==replycount && postcalls==postreplycalls) {
                // move it into the main list
                done_replies=1;
                checkdone();
              }
            //});
          }
          //console.log('uWotM8?',postreplycalls,'/',postcalls);
          postreplycalls++;
          if (postreplycalls==postcalls) {
            // we're done, there maybe repostcount outstanding, let's check
            console.log('reply done, count:',replycount,'done:',replieslist.length);
            // if we never requested anything, then we're done
            if (!replycount || replycount==replieslist.length) {
              done_replies=1;
              checkdone();
            }
          }
          //}
        });
        // get people that have starred your posts
        // up to 20 stars (as long as their recent stars)
        ref.cache.getPostStars(post.id, { count: 20 }, function(starredposts, err) {
          starcount+=starredposts.length;
          for(var j in starredposts) {
            var starpost=starredposts[j];
            //ref.getUser(starpost.userid, null, function(ruser, err) {
              starlist.push([starpost.created_at, 'star', post, starpost.userid])
              //console.log('Li',i,'vs',posts.length);
              console.log('star check',starlist.length,'vs',starcount,'starscalls',poststarcalls,'/',postcalls);
              if (starlist.length==starcount && postcalls==poststarcalls) {
                // move it into the main list
                done_stars=1;
                checkdone();
              }
            //});
          }
          poststarcalls++;
          if (poststarcalls==postcalls) {
            // we're done, there maybe repostcount outstanding, let's check
            console.log('star done, count:',starcount,'done:',starlist.length);
            // if we never requested anything, then we're done
            if (!starcount || starcount==starlist.length) {
              done_stars=1;
              checkdone();
            }
          }
        });
      }
      console.log('postcalls',postcalls);
      console.log('counts',repostcount,replycount);
      if (!postcalls) {
        // if no valid posts to inspect, we're done
        done_reposts=1;
        done_replies=1;
        done_stars=1;
      } else {
        // if post checks are done and there's no repostcost, then it's done
        // do we even need these? if there are psts, we deal with it in the replycount
        console.log('postcalls',postcalls);
        console.log('reposts',postrepostcalls,'counts',repostcount,replycount);
        console.log('replies',postreplycalls,'counts',replycount);
        console.log('stars',poststarcalls,'counts',starcount);
        //if (postcalls==postrepostcalls && !repostcount) done_reposts=1;
        //if (postcalls==postreplycalls && !replycount) done_reposts=1;
        //if (postcalls==poststarcalls && !starcount) done_stars=1;
      }
      checkdone();
    }); // getUserPosts
  },
  //
  // mute
  //
  /** @todo mute */
  //
  // block
  //
  /** @todo block */
  //
  // user
  //
  /**
   * add/update user object
   * @param {object} data - user stream object
   * @param {number} ts - timestamp of event
   * @param {metaCallback} callback - function to call after completion
   */
  updateUser: function(data, ts, callback) {
    if (!data) {
      console.log('dispatcher.js:updateUser - data is missing', data);
      callback(null, 'data is missing');
      return;
    }
    if (!data.id) {
      console.log('dispatcher.js:updateUser - id is missing', data);
      callback(null, 'id is missing');
      return;
    }

    // fix api/stream record in db format
    // this creates a reference, not a copy
    // we really need a copy otherwise we're destroying original data
    var userData=JSON.parse(JSON.stringify(data));
    userData.username=data.username.toLowerCase(); // so we can find it
    userData.created_at=new Date(data.created_at); // fix incoming created_at iso date to Date
    // if there isn't counts probably a bad input
    if (data.counts) {
      userData.following=data.counts.following;
      userData.followers=data.counts.followers;
      userData.posts=data.counts.posts;
      userData.stars=data.counts.stars;
    }
    // set avatar to null if is_default true
    userData.avatar_width=data.avatar_image.width;
    userData.avatar_height=data.avatar_image.height;
    userData.avatar_image=data.avatar_image.url;
    userData.cover_width=data.cover_image.width;
    userData.cover_height=data.cover_image.height;
    userData.cover_image=data.cover_image.url;

    if (data.description) {
      //console.log('user '+data.id+' has description', data.description.entities);
      if (data.description.entities) {
        //console.log('user '+data.id+' has entities');
        this.setEntities('user', data.id, data.description.entities, function(entities, err) {
          if (err) {
            console.log("entities Update err: "+err);
          //} else {
            //console.log("entities Updated");
          }
        });
      }
      // cache html version
      userData.descriptionhtml=data.description.html;
      // since userData is a reference to data, we can't stomp on it until we're done
      userData.description=data.description.text;
    }
    var ref=this;
    //console.log('made '+data.created_at+' become '+userData.created_at);
    // can we tell the difference between an add or update?
    this.cache.setUser(userData, ts, function(user, err, meta) {
      // only updated annotation if the timestamp is newer than we have
      // TODO: define signal if ts is old
      if (data.annotations) {
        ref.setAnnotations('user', data.id, data.annotations);
      }
      if (callback) {
        callback(user, err, meta);
      }
    });
    if (this.notsilent) {
      process.stdout.write('U');
    }
  },
  userToAPI: function(user, callback, meta) {
    //console.log('dispatcher.js::userToAPI - '+user.id, callback, meta);
    if (!user) {
      callback(null, 'dispatcher.js::userToAPI - no user passed in');
      return;
    }
    if (!callback) {
      callback(null, 'dispatcher.js::userToAPI - no callback passed in');
      return;
    }
    //console.log('dispatcher.js::userToAPI - setting up res');
    // copy user structure
    var res={
      id: user.id,
      username: user.username,
      created_at: new Date(user.created_at),
      canonical_url: user.canonical_url,
      type: user.type,
      timezone: user.timezone,
      locale: user.locale,
      avatar_image: {
        url: user.avatar_image,
        width: user.avatar_width,
        height: user.avatar_height,
        is_default: user.avatar_image==''?true:false,
      },
      cover_image: {
        url: user.cover_image,
        width: user.cover_width,
        height: user.cover_height,
        is_default: user.cover_image==''?true:false,
      },
      counts: {
        following: user.following,
        posts: user.posts,
        followers: user.followers,
        stars: user.stars,
      }
    };
    if (user.description) {
      res.description={
        text: user.description,
        html: user.description,
        entities: {
          mentions: [],
          hashtags: [],
          links: []
        }
      };
    }
    // conditionals
    if (user.name) {
      res.name=user.name; // 530 was cast as a int
    }
    if (user.verified_domain) {
      res.verified_domain=user.verified_domain;
    }
    if (user.verified_link) {
      res.verified_link=user.verified_link;
    }

    if (user.description && !res.description) {
      console.log('dispatcher.js::userToAPI - sanity check failure...');
    }

    // final peice
    if (user.description) {
      // use entity cache?
      if (1) {
        var ref=this;
        //console.log('dispatcher.js::userToAPI - getEntities '+user.id);
        this.getEntities('user', user.id, function(userEntities, userEntitiesErr, userEntitiesMeta) {
          copyentities('mentions', userEntities.mentions, res.description);
          copyentities('hashtags', userEntities.hashtags, res.description);
          copyentities('links', userEntities.links, res.description);
          // use html cache?
          if (1) {
            if (res.description) {
              res.description.html=user.descriptionhtml;
            } else {
              console.log('dispatcher.js::userToAPI - what happened to the description?!? ', user, res);
            }
            //console.log('dispatcher.js::userToAPI - calling back');
            callback(res, userEntitiesErr);
          } else {
            // you can pass entities if you want...
            ref.textProcess(user.description, function(textProc, err) {
              res.description.html=textProc.html;
              callback(res, userEntitiesErr);
            }, userEntities);
          }
        });
      } else {
        //console.log('dispatcher.js::userToAPI - textProcess description '+user.id);
        this.textProcess(user.description, function(textProc, err) {
          res.description.html=textProc.html;
          res.description.entities=textProc.entities;
          callback(res, null);
        });
      }
    } else {
      callback(res, null);
    }
  },
  getUser: function(user, params, callback) {
    //console.log('dispatcher.js::getUser - '+user, params);
    if (!callback) {
      console.log('dispatcher.js::getUser - no callback passed in');
      return;
    }
    if (!user) {
      callback(null, 'dispatcher.js::getUser - no getUser passed in');
      return;
    }
    var ref=this;
    if (user=='me') {
      console.log('getUser token', params.token);
      if (params.tokenobj) {
        console.dir(params.tokenobj);
        user=params.tokenobj.userid;
      } else {
        this.getUserClientByToken(params.token, function(usertoken, err) {
          if (usertoken==null) {
            console.log('dispatcher.js::getUser - me but not token');
            callback(null, 'dispatcher.js::getUser - me but not token');
            return;
          } else {
            ref.cache.getUser(usertoken.userid, function(userobj, userErr, userMeta) {
              //console.log('dispatcher.js::getUser - gotUser', userErr);
              ref.userToAPI(userobj, callback, userMeta);
            });
          }
        });
      }
    } else {
      var func='getUser';
      // make sure we check the cache
      if (user[0]=='@') {
        func='getUserID';
        // strip @ from beginning
        user=user.substr(1);
      }
      //console.log('dispatcher.js::getUser - calling', func);
      this.cache[func](user, function(userobj, userErr, userMeta) {
        //console.log('dispatcher.js::getUser - gotUser', userErr);
        ref.userToAPI(userobj, callback, userMeta);
      });
    }
  },
  /** user_follow */
  setFollows: function(data, deleted, id, ts) {
    // data can be null
    if (data) {
      // update user object
      if (data.user) {
        this.updateUser(data.user, ts);
      } else {
        console.log('dispatcher.js::setFollows - no user', data);
      }
      // update user object
      if (data.follows_user) {
        this.updateUser(data.follows_user, ts);
      } else {
        console.log('dispatcher.js::setFollows - no follows_user', data);
      }
      // set relationship status
      this.cache.setFollow(data.user.id, data.follows_user.id, id, deleted, ts);
    } else {
      // likely deleted is true in this path
      this.cache.setFollow(0, 0, id, deleted, ts);
    }
    if (this.notsilent) {
      process.stdout.write(deleted?'f':'F');
    }
  },
  getFollowings: function(userid, params, callback) {
    this.cache.getFollowing(userid, params, callback);
  },
  getFollowers: function(userid, params, callback) {
    this.cache.getFollows(userid, params, callback);
  },
  /** files */
  getFile: function(fileid, params, callback) {
    console.log('dispatcher.js::getFile - write me!');
    callback(null, null);
  },
  setFile: function(data, deleted, id, ts, callback) {
    // map data onto model
    if (data.user) {
      this.updateUser(data.user);
    }
    var file=data;
    if (deleted) {
      file.id=id; // we need this for delete
    }
    file.userid=data.user.id;
    // client_id?
    // data.source handling...
    this.cache.setFile(data, deleted, id, callback);
    // file annotations are this mutable
    // if so we need to make sure we only update if timestamp if newer
    /*
      if (data.annotations) {
        ref.setAnnotations('file', data.id, data.annotations);
      }
    */
  },
  /** client */
  getSource: function(source, callback) {
    if (source==undefined) {
      callback(null, 'source is undefined');
      return;
    }
    //console.dir(source);
    var ref=this.cache;
    console.log('dispatcher.js::getSource ', source.client_id);
    this.cache.getClient(source.client_id, function(client, err, meta) {
      if (client==null || err) {
        //console.log('dispatcher.js::getSource failure ', err, client);
        // we need to create it
        ref.addSource(source.client_id, source.name, source.link, callback);
      } else {
        callback(client, err, meta);
      }
    });
    if (this.notsilent) {
      process.stdout.write('c');
    }
  },
  getClient: function(client_id, callback, shouldAdd) {
    if (client_id==undefined) {
      callback(null, 'client_id is undefined');
      return;
    }
    if (client_id==null) {
      callback(null, 'client_id is null');
      return;
    }
    var ref=this.cache;
    //console.log('dispatcher.js::getClient', client_id);
    this.cache.getClient(client_id, function(client, err, meta) {
      if (client==null || err) {
        console.log('dispatcher.js::getClient failure '+err);
        // should we just be setClient??
        if (shouldAdd!=undefined) {
          console.log("Should add client_id: "+client_id, shouldAdd);
          //var source={ client_id: client_id, name: ??, link: ?? };
          //ref.setSource();
        }
        // make dummy
        var client={
          name: 'Unknown',
          link: 'nowhere',
          client_id: client_id
        };
      }
      callback(client, err, meta);
    });
  },
  /** entities */
  getEntities: function(type, id, callback) {
    this.cache.getEntities(type, id, callback);
  },
  setEntities: function(type, id, entities, callback) {
    //console.dir('dispatcher.js::setEntities - '+type, entities);
    // I'm pretty sure these arrays are always set
    if (entities.mentions && entities.mentions.length) {
      this.cache.extractEntities(type, id, entities.mentions, 'mention', function(nEntities, err, meta) {
      });
      if (this.notsilent) {
        process.stdout.write('@');
      }
    }
    if (entities.hashtags && entities.hashtags.length) {
      this.cache.extractEntities(type, id, entities.hashtags, 'hashtag', function(nEntities, err, meta) {
      });
      if (this.notsilent) {
        process.stdout.write('#');
      }
    }
    if (entities.links && entities.links.length) {
      this.cache.extractEntities(type, id, entities.links, 'link', function(nEntities, err, meta) {
      });
      if (this.notsilent) {
        process.stdout.write('^');
      }
    }
  },
  /** annotations */
  getAnnotation: function(type, id, callback) {
    this.cache.getAnnotations(type, id, callback);
  },
  setAnnotations: function(type, id, annotations, callback) {
    // probably should clear all the existing anntations for this ID
    // channel annotations mutable
    // and we don't have a unique constraint to tell if it's an add or update or del
    var ref=this;
    this.cache.clearAnnotations(type, id, function() {
      for(var i in annotations) {
        var note=annotations[i];
        // insert into idtype, id, type, value
        // type, id, note.type, note.value
        ref.cache.addAnnotation(type, id, note.type, note.value, function(nNote, err) {
          if (err) {
            console.log('dispatcher.js::setAnnotations - addAnnotation failure', err);
          //} else {
          }
          if (this.notsilent) {
            process.stdout.write('a');
          }
          /*
          if (note.value.length) {
            writevaluearray(id, note.value);
          }
          */
        });
      }
      if (callback) {
        // what would we return??
        callback();
      }
    });
  },
  /** text process */
  textProcess: function(text, entities, postcontext, callback) {
    var ref=this;
    var html=text;
    var mentions=[];
    var hashtags=[];
    var links=[];
    // from patter @duerig
    // FIXME: these text ranges aren't very i8n friendly, what about UTF stuff huh?
    var mentionRegex = /@([a-zA-Z0-9\-_]+)\b/g;
    var hashtagRegex = /#([a-zA-Z0-9\-_]+)\b/g;
    // https://gist.github.com/gruber/8891611
    // https://alpha.app.net/dalton/post/6597#6595
    var urlRegex = /\b((?:https?:(?:\/{1,3}|[a-z0-9%])|[a-z0-9.\-]+[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\/)(?:[^\s()<>{}\[\]]+|\([^\s()]*?\([^\s()]+\)[^\s()]*?\)|\([^\s]+?\))+(?:\([^\s()]*?\([^\s()]+\)[^\s()]*?\)|\([^\s]+?\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’])|(?:[a-z0-9]+(?:[.\-][a-z0-9]+)*[.](?:com|net|org|edu|gov|mil|aero|asia|biz|cat|coop|info|int|jobs|mobi|museum|name|post|pro|tel|travel|xxx|ac|ad|ae|af|ag|ai|al|am|an|ao|aq|ar|as|at|au|aw|ax|az|ba|bb|bd|be|bf|bg|bh|bi|bj|bm|bn|bo|br|bs|bt|bv|bw|by|bz|ca|cc|cd|cf|cg|ch|ci|ck|cl|cm|cn|co|cr|cs|cu|cv|cx|cy|cz|dd|de|dj|dk|dm|do|dz|ec|ee|eg|eh|er|es|et|eu|fi|fj|fk|fm|fo|fr|ga|gb|gd|ge|gf|gg|gh|gi|gl|gm|gn|gp|gq|gr|gs|gt|gu|gw|gy|hk|hm|hn|hr|ht|hu|id|ie|il|im|in|io|iq|ir|is|it|je|jm|jo|jp|ke|kg|kh|ki|km|kn|kp|kr|kw|ky|kz|la|lb|lc|li|lk|lr|ls|lt|lu|lv|ly|ma|mc|md|me|mg|mh|mk|ml|mm|mn|mo|mp|mq|mr|ms|mt|mu|mv|mw|mx|my|mz|na|nc|ne|nf|ng|ni|nl|no|np|nr|nu|nz|om|pa|pe|pf|pg|ph|pk|pl|pm|pn|pr|ps|pt|pw|py|qa|re|ro|rs|ru|rw|sa|sb|sc|sd|se|sg|sh|si|sj|Ja|sk|sl|sm|sn|so|sr|ss|st|su|sv|sx|sy|sz|tc|td|tf|tg|th|tj|tk|tl|tm|tn|to|tp|tr|tt|tv|tw|tz|ua|ug|uk|us|uy|uz|va|vc|ve|vg|vi|vn|vu|wf|ws|ye|yt|yu|za|zm|zw)\b\/?))/ig;

    // data-mention-id="$1" will have to do a look up pass and set this back
    html = html.replace(mentionRegex, '<span data-mention-name="$1" itemprop="mention">@$1</span>');
    html = html.replace(hashtagRegex, '<span data-hashtag-name="$1" itemprop="hashtag">#$1</span>');

    // since input is text, I believe we can safely assume it's not already in a tag
    // FIXME: we need to insert http:// if there's no protocol (post: 30795290)
    // be sure to check your html/entity caching to make sure it's off otherwise 30795290 is fine
    html = html.replace(urlRegex, '<a href="$1">$1</a>');

    var userlookup={};

    var finishcleanup=function(html, text, callback) {
      if (!entities) {
        var lastmenpos=0;
        while(match=mentionRegex.exec(text)) {
          //console.log('Found '+match[1]+' at '+match.index);
          var username=match[1].toLowerCase();
          //console.log('@'+match.index+' vs '+lastmenpos);
          var obj={
            pos: match.index,
            id: ''+userlookup[username],
            len: username.length+1, // includes char for @
            name: username,
          }
          if (postcontext) {
            // means no text before the mention...
            obj.is_leading=match.index==lastmenpos;
          }
          mentions.push(obj);
          // while we're matching
          if (match.index==lastmenpos) {
            // update it
            lastmenpos=match.index+username.length+2; // @ and space after wards
          }
        }
        // FIXME: 30792555 invisible hashtags?
        // we're not encoding text right...
        while(match=hashtagRegex.exec(text)) {
          var hashtag=match[1];
          var obj={
            name: hashtag,
            pos: match.index,
            len: hashtag.length+1, // includes char for #
          }
          hashtags.push(obj);
        }
        while(match=urlRegex.exec(text)) {
          var url=match[1];
          // we need to insert http:// if there's no protocol (post: 30795290)
          // FIXME: colon isn't good enough
          var text=url;
          if (url.indexOf(':')==-1) {
            url='http://'+url;
          }
          var obj={
            url: url,
            text: text,
            pos: match.index,
            len: text.length,
          }
          links.push(obj);
        }

        /*
        console.dir(mentions);
        console.dir(hashtags);
        console.dir(links);
        */

        entities={
          mentions: mentions,
          hashtags: hashtags,
          links: links
        };
      }

      // unicode chars
      // <>\&
      html = html.replace(/[\u00A0-\u9999]/gim, function(i) {
         return '&#'+i.charCodeAt(0)+';';
      });

      // remove line breaks
      html=html.replace(/\r/g, '&#13;');
      html=html.replace(/\n/g, '<br>');

      var res={
        entities: entities,
        html: '<span itemscope="https://app.net/schemas/Post">'+html+'</span>',
        text: text
      };
      callback(res, null);
    }

    var mentionsSrch=text.match(mentionRegex);
    var launches=0, completed=0;
    if (mentionsSrch && mentionsSrch.length) {
      for(var i in mentionsSrch) {
        var mention=mentionsSrch[i]; // with @
        //RegExp.$1 // without @
        //var username=RegExp.$1;
        var username=mention.substr(1);
        //console.log("Replacing "+username);
        launches++;
        ref.cache.getUserID(username, function(user, userErr, userMeta) {
          //console.log('Searching for '+user.username);
          userlookup[user.username]=user.id;
          // fix up missing user ids
          var pattern=new RegExp(' data-mention-name="'+user.username, 'gi');
          html=html.replace(pattern, ' data-mention-id="'+user.id+'" data-mention-name="'+user.username);
          //console.log('Adjusted html '+html);
          completed++;
          //console.log(completed+'/'+launches);
          // tired/lazy man's promise
          // I'm concerned that if we queue 2 and then finish 2, we may trigger the ending early
          // and possibly more than once
          if (completed==launches) {
            finishcleanup(html, text, callback);
          }
        });
      }
    } else {
      finishcleanup(html, text, callback);
    }

  },
  /** config **/
  // change to callback style?
  getConfig: function() {
    return this.config;
  },
  /** oembed **/
  getOEmbed: function(url, callback) {
    this.cache.getOEmbed(url, callback);
  },
  /** dispatcher for streamrouter */
  dispatch: function(userid, json) {
    // remember json is in app streaming format!
    //console.dir(json);
    var data=json.data;
    var meta=json.meta;
    // the missing meta is going to be an issue
    /*
     { meta:
       { suppress_notifications_all: false,
         timestamp: 1399812206341,
         type: 'post',
         id: '30224684',
         suppress_notifications: [] },
    */
    switch(meta.type) {
      case 'post':
        // transfer stream encoding over to normal post structure
        if (meta && meta.is_deleted) {
          if (data==undefined) data={};
          data.is_deleted=true;
        }
        if (data.id) {
          this.setPost(data);
        }
      break;
      case 'channel':
        this.setChannel(data, meta.timestamp);
      break;
      case 'message':
        // meta.timestamp is important here for channels
        this.setMessage(data, meta.timestamp);
      break;
      case 'channel_subscription':
        this.setChannelSubscription(data, meta.is_deleted, meta.timestamp);
      break;
      case 'file':
        console.log('file');
      break;
      case 'stream_marker':
        console.log('stream_marker');
      break;
      case 'token':
        console.log('token');
      break;
      case 'star':
        this.setStar(data, meta.is_deleted, meta.id, meta.timestamp);
      break;
      case 'mute':
        console.log('mute');
      break;
      case 'block':
        console.log('block');
      break;
      case 'user':
        this.updateUser(data, meta.timestamp);
      break;
      case 'user_follow':
        if (data) {
          this.setFollows(data, meta.is_deleted, meta.id, meta.timestamp);
        } else {
          this.setFollows(null, meta.is_deleted, meta.id, meta.timestamp);
        }
      break;
      default:
        console.log("dispatcher.js::dispatch - unknown appstream type ["+meta.type+"]");
      break;
    }
    // done with data
    data=false;
    meta=false;
    json=false;
  }
  /**
   * This callback is displayed as part of Dispatcher class
   * @callback setPostCallback
   * @param {object} post object
   * @param {string} error
   */
  /**
   * This is a callback that passes back the meta data as well
   * @callback metaCallback
   * @param {object} post post data object
   * @param {?string} error null if no errors, otherwise string
   * @param {object} meta meta object
   */

}

