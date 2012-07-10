// FIXME:
// * fix glide routines (and use transitions)
// * ensure scroll info/events are available (e.g. for OnDemandList)

define(["dojo/_base/declare", "dojo/on", "./util/has-css3", "./util/touch", "put-selector/put", "xstyle/css!./css/TouchScroll.css"],
function(declare, on, has, touchUtil, put){
	var
		calcTimerRes = 100, // ms between drag velocity measurements
		glideTimerRes = 30, // ms between glide animation ticks
		transitionDuration = 250, // duration (ms) for each CSS transition step
		touches = {}, // records number of touches on components
		current = {}, // records info for widget(s) currently being scrolled
		glideThreshold = 1, // speed (in px) below which to stop glide - TODO: remove
		// RegExps for parsing relevant x/y from translate and matrix values:
		translateRx = /^translate(?:3d)?\((-?\d+)(?:px)?, (-?\d+)/,
		matrixRx = /^matrix\(1, 0, 0, 1, (-?\d+)(?:\.\d*)?(?:px)?, (-?\d+)/,
		// store has-features we need, for computing property/function names:
		hasTransitions = has("css-transitions"),
		hasTransitionEnd = has("transitionend"),
		hasTransforms = has("css-transforms"),
		hasTransforms3d = has("css-transforms3d"),
		// and declare vars to store info on the properties/functions we'll need
		cssPrefix, transitionPrefix, transformProp, translatePrefix, translateSuffix, transitionend;
	
	if(hasTransforms3d){
		translatePrefix = "translate3d(";
		translateSuffix = ",0)";
	}else if(hasTransforms){
		translatePrefix = "translate(";
		translateSuffix = ")";
	}
	
	if(!hasTransitions || !translatePrefix){
		console.warn("CSS3 features unavailable for touch scroll effects.");
		return function(){};
	}
	
	// figure out strings for use later in events
	transformProp = hasTransforms3d || hasTransforms;
	transformProp = transformProp === true ? "transform" : transformProp + "Transform";
	transitionend = hasTransitionEnd === true ? "transitionend" :
		hasTransitionEnd + "TransitionEnd";
	transitionPrefix = hasTransitions === true ? "transition" :
		hasTransitions + "Transition";
	cssPrefix = hasTransforms === true ? "" :
		"-" + hasTransforms.toLowerCase() + "-";
	
	function showScrollbars(widget){
		// Handles displaying of X/Y scrollbars as appropriate when a touchstart
		// occurs.
		
		var node = widget.touchNode,
			parentNode = node.parentNode,
			scrollbarNode;
		
		if(node.scrollWidth > parentNode.offsetWidth){
			scrollbarNode = widget._scrollbarXNode =
				widget._scrollbarXNode || put(parentNode, "div.touchscroll-bar-x");
			scrollbarNode.style.width =
				parentNode.offsetWidth * parentNode.offsetWidth / node.scrollWidth + "px";
			scrollbarNode.style.left = node.offsetLeft + "px";
			put(parentNode, ".touchscroll-scrolling-x");
		}
		if(node.scrollHeight > parentNode.offsetHeight){
			scrollbarNode = widget._scrollbarYNode =
				widget._scrollbarYNode || put(parentNode, "div.touchscroll-bar-y");
			scrollbarNode.style.height =
				parentNode.offsetHeight * parentNode.offsetHeight / node.scrollHeight + "px";
			scrollbarNode.style.top = node.offsetTop + "px";
			put(parentNode, ".touchscroll-scrolling-y");
		}
	}
	
	function scroll(widget, x, y){
		// Handles updating of scroll position (from touchmove or glide).
		// NOTE: currently this is passed negative x and y values; should likely be flipped.
		
		var node = widget.touchNode,
			parentNode = node.parentNode;
		
		// Update transform on touchNode
		node.style[transformProp] =
			translatePrefix + x + "px," + y + "px" + translateSuffix;
		
		// Update scrollbar positions
		if(widget._scrollbarXNode){
			widget._scrollbarXNode.style[transformProp] = translatePrefix +
				(-x * parentNode.offsetWidth / node.scrollWidth) + "px,0" + translateSuffix;
		}
		if(widget._scrollbarYNode){
			widget._scrollbarYNode.style[transformProp] = translatePrefix + "0," +
				(-y * parentNode.offsetHeight / node.scrollHeight) + "px" + translateSuffix;
		}
		
		// Emit a scroll event that can be captured by handlers, passing along
		// scroll information in the event itself (since we already have the info,
		// and it'd be difficult to get from the node).
		on.emit(widget.touchNode.parentNode, "scroll", {
			scrollLeft: -x,
			scrollTop: -y
		});
	}
	
	// functions for handling touch events on node to be scrolled
	
	function ontouchstart(evt){
		var widget = evt.widget,
			id = widget.id,
			posX = 0,
			posY = 0,
			touch, match, curr;
		
		// Check touches count (which hasn't counted this touch yet);
		// ignore touch events on inappropriate number of contact points.
		if(touches[id] !== widget.touchesToScroll - 1){ return; }
		
		if((curr = current[id])){
			// determine current translate X/Y from final used values
			match = matrixRx.exec(window.getComputedStyle(this)[transformProp]);
		}else{
			// determine current translate X/Y from applied style
			match = translateRx.exec(this.style[transformProp]);
		}
		if(match){
			posX = +match[1];
			posY = +match[2];
		}
		if(curr){
			// stop any active glide on this widget, since it's been re-touched
			clearTimeout(curr.timer);
			this.style[transitionPrefix + "Duration"] = "0";
			this.style[transformProp] =
				translatePrefix + posX + "px," + posY + "px" + translateSuffix;
		}
		
		showScrollbars(widget, this);
		
		touch = evt.targetTouches[0];
		curr = current[id] = {
			widget: widget,
			node: this,
			// subtract touch coords now, then add back later, so that translation
			// goes further negative when moving upwards
			startX: posX - touch.pageX,
			startY: posY - touch.pageY,
			tickFunc: function(){ calcTick(id); }
		};
		curr.timer = setTimeout(curr.tickFunc, calcTimerRes);
	}
	function ontouchmove(evt){
		var widget = evt.widget,
			id = widget.id,
			curr = current[id],
			parentNode = this.parentNode,
			touch, nx, ny;
		
		// Ignore touchmove events with inappropriate number of contact points.
		if(touches[id] !== widget.touchesToScroll || !curr){
			if(touches[id] < widget.touchesToScroll && widget.preventDefaultMove){
				evt.preventDefault();
			}
			return;
		}
		
		touch = evt.targetTouches[0];
		nx = Math.max(Math.min(0, curr.startX + touch.pageX),
			-(this.scrollWidth - parentNode.offsetWidth));
		ny = Math.max(Math.min(0, curr.startY + touch.pageY),
			-(this.scrollHeight - parentNode.offsetHeight));
		
		// squelch the event and scroll the area
		evt.preventDefault();
		evt.stopPropagation();
		scroll(widget, nx, ny);
	}
	function ontouchend(evt){
		var widget = evt.widget,
			id = widget.id,
			curr = current[id];
		
		if(touches[id] != widget.touchesToScroll || !curr){ return; }
		if(curr.timer){ clearTimeout(curr.timer); }
		startGlide(curr);
	}
	
	// glide-related functions
	
	function calcTick(id){
		// Calculates current speed of touch drag
		var curr = current[id],
			node, match, x, y;
		
		if(!curr){ return; } // no currently-scrolling widget; abort
		
		node = curr.node;
		match = translateRx.exec(node.style[transformProp]);
		
		// set previous reference point for future iteration or calculation
		if(match){
			curr.lastX = +match[1];
			curr.lastY = +match[2];
		} else {
			curr.lastX = curr.lastY = 0;
		}
		curr.lastTick = new Date();
		curr.timer = setTimeout(curr.tickFunc, calcTimerRes);
	}
	
	function startGlide(curr){
		// starts glide operation when drag ends
		var lastX = curr.lastX,
			lastY = curr.lastY,
			id = curr.widget.id,
			time, match, posX, posY, velX, velY;
		
		// calculate velocity based on time and displacement since last tick
		curr.timer && clearTimeout(curr.timer);
		time = (new Date()) - curr.lastTick;
		match = translateRx.exec(curr.node.style[transformProp]);
		if(match){
			posX = +match[1];
			posY = +match[2];
		} else {
			posX = posY = 0;
		}
		
		// TODO: timerRes -> transitionDuration
		velX = (posX - lastX) / calcTimerRes;
		velY = (posY - lastY) / calcTimerRes;
		
		//if(!velX && !velY){ // no glide to perform
			put(curr.node.parentNode, "!touchscroll-scrolling-x!touchscroll-scrolling-y");
			delete current[id];
			return;
		//}
		
		// update lastX/Y with current position, for glide calculations
		curr.lastX = posX;
		curr.lastY = posY;
		curr.velX = velX;
		curr.velY = velY;
		curr.calcFunc = function(){ calcGlide(id); };
		curr.timer = setTimeout(curr.calcFunc, glideTimerRes);
	}
	function calcGlide(id){
		// performs glide and decelerates according to widget's glideDecel method
		var curr = current[id],
			node, widget,
			x, y, nx, ny, nvx, nvy; // old/new coords and new velocities
		
		if(!curr){ return; }
		
		node = curr.node;
		widget = curr.widget;
		x = curr.lastX;
		y = curr.lastY;
		nvx = widget.glideDecel(curr.velX);
		nvy = widget.glideDecel(curr.velY);
		
		if(Math.abs(nvx) >= glideThreshold || Math.abs(nvy) >= glideThreshold){
			// still above stop threshold; update transformation
			nx = Math.max(Math.min(0, x + nvx), -(node.scrollWidth - node.offsetWidth));
			ny = Math.max(Math.min(0, y + nvy), -(node.scrollHeight - node.offsetHeight));
			if(nx != x || ny != y){
				// still scrollable; update offsets/velocities and schedule next tick
				scroll(widget, nx, ny);
				// update information
				curr.lastX = nx;
				curr.lastY = ny;
				curr.velX = nvx;
				curr.velY = nvy;
				curr.timer = setTimeout(curr.calcFunc, glideTimerRes);
			}else{
				put(node.parentNode, "!touchscroll-scrolling-x!touchscroll-scrolling-y");
				delete current[id];
			}
		}
	}
	
	function incrementTouchCount(evt){
		touches[evt.widget.id] += evt.changedTouches.length;
	}
	function decrementTouchCount(evt){
		touches[evt.widget.id] -= evt.changedTouches.length;
	}
	
	return declare([], {
		// touchesToScroll: Number
		//		Number of touches to require on the component's touch target node
		//		in order to trigger scrolling behavior.
		touchesToScroll: 1,
		
		// preventDefaultMove: Boolean
		//		Controls whether touchmove events are prevented specifically when
		//		the number of touches on the given component is less than the value
		//		of touchesToScroll.  Useful particularly for platforms which will
		//		automatically scroll anyway, otherwise.
		preventDefaultMove: false,
		
		// touchNode: DOMNode?
		//		Node upon which event listeners should be hooked and scroll behavior
		//		should be based.  If not specified, defaults to containerNode or
		//		domNode (in that order).
		touchNode: null,
		
		startup: function(){
			if(!this._started){
				this._initTouch();
				this.inherited(arguments);
			}
		},
		
		_initTouch: function(){
			var node = this.touchNode = this.touchNode || this.containerNode,
				widget = this;
			
			if(!node || !node.parentNode){
				// Bail out if we have no touchNode or containerNode, or if we don't
				// seem to have a parent node to work with.
				console.warn("TouchScroll requires a nested node upon which to operate.");
				return;
			}
			
			// Set overflow to hidden in order to prevent any native scroll logic.
			node.parentNode.style.overflow = "hidden";
			
			node.style[transitionPrefix + "Property"] = cssPrefix + "transform";
			
			function wrapHandler(func){
				return function(evt){
					evt.widget = widget;
					func.call(this, evt);
				};
			}
			
			touches[this.id] = 0;
			
			this._touchScrollListeners = [
				on(node, "touchstart", wrapHandler(ontouchstart)),
				on(node, "touchmove", wrapHandler(ontouchmove)),
				on(node, "touchend,touchcancel", wrapHandler(ontouchend)),
				// Don't need to wrap the following, since the touchstart handler
				// above already decorates the event
				on(node, "touchstart", incrementTouchCount),
				on(node, "touchend,touchcancel", decrementTouchCount)
			];
		},
		
		destroy: function(){
			var i = this._touchScrollListeners.length;
			while(i--){
				this._touchScrollListeners[i].remove();
			}
			delete touches[this.id];
			delete current[this.id];
			
			this.inherited(arguments);
		},
		
		glideDecel: function(n){
			// summary:
			//		Deceleration algorithm. Given a number representing velocity,
			//		returns a new velocity to impose for the next "tick".
			//		(Don't forget that velocity can be positive or negative!)
			return n * 0.9; // Number
		}
	});
});
