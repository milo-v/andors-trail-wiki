import React from 'react';
import { DATA_BASE } from '../../utils/dataBase';

export default class Icon extends React.Component {

    render() {

        const {data, zoom}= this.props;

        const ts = data.tileset;
        if (!ts) return <div style={{
                position: 'absolute', 
                top: this.props.y, left: this.props.x,
                width:32, height:32,
                backgroundColor: 'red', opacity: 0.5,
            }} />;
        const file = ts.name;
        const index = data.localid;
        const src = getSrc(file);
        
        const dx = ts.tilewidth * zoom / 32;
        const dy = ts.tileheight * zoom / 32;

        var p = getPosition(index, ts, dx, dy, zoom);
        var style = { margin: `${p.y}px 0 0 ${p.x}px`, width: `${p.w}px`, display: 'block'};

        return <div style={{ width:`${dx}px`, height:`${dy}px`, overflow: 'hidden',
                            position: 'absolute', left: this.props.x, top: this.props.y
                            }} >
                    <img alt="" src={src} style={style} />
               </div>
    }
}
    const getSrc = (file) => {
        if (!file) return;
        return process.env.PUBLIC_URL+DATA_BASE+"/drawable/"+file+".png";
    }
    const getPosition = (i, ts, dx, dy, zoom) => {
        var w = ts.width * zoom / 32;
        var width = ts.width / ts.tilewidth;
        var x = - i % width * dx;
        var y = (- i * dy - x) / width;
        return {x, y, w};
    }

