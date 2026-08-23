import React,{useState,useEffect,useRef} from 'react';
import './App.css';
import Main from './components/Main.jsx';
import XMLParser from 'react-xml-parser';
import parseXmlMap from './utils/MapParser.jsx';
import parseGlobalMap from './utils/GlobalMapParser.jsx';
import { getCachedData, setCachedData, CACHE_SCHEMA_VERSION } from './utils/dataCache';
import { DATA_BASE, DISPLAY_VERSION } from './utils/dataBase';
import { fetchWithTimeout } from './utils/fetchWithTimeout';

const FETCH_TIMEOUT_MS = 15000;

function App() {
  const [data,setData]=useState([]);
  const [mapsProgress, setMapsProgress] = useState(undefined);
  const [mapsMaxProgress, setMapsMaxProgress] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const generationRef = useRef(0);
  const loadStartRef = useRef(0);
  // eslint-disable-next-line no-extend-native
  String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
  }

  const appCacheKey = `app-v${CACHE_SCHEMA_VERSION}-${DATA_BASE || 'stable'}-${DISPLAY_VERSION}`;

  useEffect(()=>{
    const generation = ++generationRef.current;
    const isStale = () => generation !== generationRef.current;
    var  temp = { maps: {} };

    loadStartRef.current = Date.now();
    setLoadError(null);
    setMapsProgress(undefined);
    setMapsMaxProgress(undefined);

    const onLoadError = (err) => {
      if (isStale()) return;
      console.warn('App: loading failed', err);
      setLoadError(err);
    }

    const getXmlData=(fileName, thenDo)=>{
      const headers = {
        'Content-Type': 'text/xml',
        'Accept': 'text/xml'
      };
      fetchWithTimeout(''+fileName, {headers}, FETCH_TIMEOUT_MS)
        .then(response => {
          if (!response.ok) throw new Error(`${fileName}: HTTP ${response.status}`);
          return response.text();
        })
        .then(str => {
          return str.replace(/<!--.*-->/g,'');
        })
        .then(thenDo)
        .catch(onLoadError);
    }
    const saveTempResources = (str) => {
      if (isStale()) return;
      var parser = new XMLParser();
      var myXml = parser.parseFromString(str);

      var xmlData=myXml.getElementsByTagName("array");
      const resources = xmlData.reduce(function(map, obj) {
        map[obj.attributes.name] = obj.children.map(o=>o.value).filter(e=>e);
        return map;
      }, {});
      temp = {
          ...temp,
          resources
      };
      getMaps(temp, (finished) => { if (!isStale()) setData(finished); });
    }

    const getXmlMap=(resource, name, downcounter)=>{
      const thenDo = (xmlString) => {
        if (isStale()) return;
        var parser = new XMLParser();
        var myXml = parser.parseFromString(xmlString);

        temp.maps[name] = parseXmlMap(myXml, name);
        downcounter.progress--
        setMapsProgress(downcounter.progress);
        if (downcounter.progress===0){
          downcounter.tryDo();
        }
      }
      getXmlData(resource, thenDo)
    }

    const getGlobalMap =(downcounter) => {
      const thenDo = (xmlString) => {
        if (isStale()) return;
        var parser = new XMLParser();
        var myXml = parser.parseFromString(xmlString);

        temp.globalMap = parseGlobalMap(myXml);
        downcounter.progress--
        setMapsProgress(downcounter.progress);
        if (downcounter.progress===0){
          downcounter.tryDo();
        }
      }
      getXmlData(process.env.PUBLIC_URL+DATA_BASE+"/xml/worldmap.xml", thenDo);
    }

    const getMaps=(temp, thenDo)=>{
      var maps = temp.resources.loadresource_maps;
      var downcounter = {
        progress: maps.length+1,
        maxProgress: maps.length+1,
        tryDo:()=>{
          setCachedData(appCacheKey, temp);
          thenDo(temp);
        }
      };
      setMapsMaxProgress(downcounter.maxProgress);
      setMapsProgress(downcounter.progress);
      getGlobalMap(downcounter);
      maps.forEach((path)=>{
        getXmlMap(process.env.PUBLIC_URL+DATA_BASE+path.replace('@','/')+".tmx", path.replace('@xml/',''), downcounter);
      });
    }

    getCachedData(appCacheKey).then((cached) => {
      if (isStale()) return;
      if (cached) {
        setData(cached);
      } else {
        getXmlData(process.env.PUBLIC_URL+DATA_BASE+'/values/loadresources.xml', saveTempResources);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[retryToken])

  const retry = () => setRetryToken(t => t + 1);

  // Mobile browsers can suspend a backgrounded tab mid-fetch; on resume the
  // request is often silently dead. If the tab becomes visible again while
  // we're still stuck loading (and we've had long enough to have finished or
  // timed out normally), retry once instead of leaving the user stuck.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (data.resources || data.maps) return;
      if (Date.now() - loadStartRef.current < FETCH_TIMEOUT_MS) return;
      retry();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="App">
        <Main
          resources = { data.resources }
          maps = { data.maps }
          globalMap = { data.globalMap }
          mapsProgress = { mapsProgress }
          mapsMaxProgress = { mapsMaxProgress }
          loadError = { loadError }
          onRetryLoad = { retry }
        />
    </div>
  );
}

export default App;
