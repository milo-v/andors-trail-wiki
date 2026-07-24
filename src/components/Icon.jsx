import React from 'react';
import { HashLink as Link } from 'react-router-hash-link';
import { DATA_BASE } from '../utils/dataBase';

const custom = {
    monsters_demon1:{x:64, y:64},
    monsters_demon2:{x:64, y:64},
    monsters_hydra1:{x:64, y:64},
    monsters_cyclops:{x:64, y:96},
    monsters_bosses_2x2:{x:64, y:64},
    monsters_giantbasilisk:{x:64, y:64},
}

export const getDimentionById = (id) => getDimention(id?.split(":")[0]);
// Always a fresh object: callers (render() and applyPosition() below both
// scale the result in place by a zoom factor) must not share/mutate the
// same custom[file] entry across calls, or repeated calls would compound
// the scaling instead of each starting from the canonical base dimensions.
export const getDimention = (file) => ({ ...(custom[file] || { x: 32, y: 32 }) });

export default class Icon extends React.Component {

    constructor(props) {
        super(props);
        this.imgRef = React.createRef();
        this.applyPosition = this.applyPosition.bind(this);
    }

    componentDidMount() {
        this.applyPosition();
    }

    // A row reusing this same Icon instance for a different item (e.g. the
    // optimizer's top10 table refreshing) only fires the <img>'s onLoad again
    // if `src` actually changes - when the new item's sprite lives in the
    // same file, the browser never re-fires `load`, so the previous item's
    // manually-computed margin/position would otherwise stick. Re-applying
    // here on every prop update (in addition to onLoad, for the case where
    // `src` does change and the new image isn't cached yet) covers both.
    componentDidUpdate() {
        this.applyPosition();
    }

    applyPosition() {
        const img = this.imgRef.current;
        if (!img) return;
        const tmp = this.props.data.iconID?.split(":");
        const index = tmp && tmp[1];
        if (!index) {
            // No sprite index to position by - clear any margin a
            // previously-shown item (reusing this same instance) left
            // behind, rather than letting a stale offset persist.
            img.style.margin = '';
            return;
        }
        // img.complete is false while a just-changed src is still loading -
        // onLoad will fire and call this again once it's ready. When true
        // (the common case: same cached sprite file, only the index moved),
        // apply the position immediately instead of waiting for a load event
        // that won't come.
        if (!img.complete || !img.naturalWidth) return;
        const d = getDimention(tmp[0]);
        const zoom = this.props.zoom || 32;
        d.x = d.x * zoom / 32;
        d.y = d.y * zoom / 32;
        const p = getPosition(index, img.width / d.x, d);
        img.style.margin = `${p.y}px 0 0 ${p.x}px`;
        img.style.display = 'block';
    }

    render() {
        const {data, prefix, noBackground}= this.props;
        const zoom = this.props.zoom || 32;

        const href = (data.rootLink || prefix) + (data.id||data.name);
        const tmp = data.iconID?.split(":");
        const file = tmp[0];
        const src = getSrc(file);
        const d = getDimention(file);

        d.x = d.x * zoom / 32;
        d.y = d.y * zoom / 32;

        var style = {
            width:d.x,
            height:d.y,
            overflow: 'hidden'
        }
        if (!noBackground) {
            style = {
                ...style,
                backgroundImage: 'url("'+process.env.PUBLIC_URL+DATA_BASE+'/drawable/ui_selections.png")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: (data.iconBg * d.x) + "px 0px",
                backgroundSize: (d.x * 5) + "px " + d.y + "px",

            };
        };

        return <div style={{ display:'flex'}}>

                        <Link style={style}
                           title={data.displaytype}
                           to={href}>
                                <div id={data.id} className="TableAncor"/>
                                <img alt="" ref={this.imgRef}
                                    src={src}
                                    onLoad={this.applyPosition}
                                    />
                        </Link>
                    </div>;
    }
}
    const getSrc = (file) => {
        if (!file) return;
        return process.env.PUBLIC_URL+DATA_BASE+"/drawable/"+file+".png";
    }
    const getPosition = (i, width, d) => {
        var x = - i % width * d.x;
        var y = (- i * d.y - x) / width;
        return {x, y};
    }

